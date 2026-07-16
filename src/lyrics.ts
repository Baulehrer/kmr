import db, { type LyricsCacheRow } from "./db"
import { normalizeCatalogTitle } from "./ma-client"
import type { LyricLine, LyricsResult, ResolvedTrack } from "./types"

const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MISS_TTL_MS = 24 * 60 * 60 * 1000

export function parseLrc(value: string): LyricLine[] {
  const offsetMatch = value.match(/^\[offset:([+-]?\d+)]/im)
  const offset = offsetMatch ? Number.parseInt(offsetMatch[1]!, 10) : 0
  const lines: LyricLine[] = []
  for (const raw of value.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]/g)]
    if (stamps.length === 0) continue
    const text = raw.replace(/\[[^\]]+]/g, "").replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "").trim() || "♪"
    for (const stamp of stamps) {
      const minutes = Number.parseInt(stamp[1]!, 10)
      const seconds = Number.parseInt(stamp[2]!, 10)
      const fraction = stamp[3] || "0"
      const millis = fraction.length === 1 ? Number(fraction) * 100 : fraction.length === 2 ? Number(fraction) * 10 : Number(fraction.slice(0, 3))
      lines.push({ startMs: Math.max(0, minutes * 60_000 + seconds * 1000 + millis + offset), text })
    }
  }
  return lines.sort((a, b) => a.startMs - b.startMs)
}

export function activeLyricIndex(lines: LyricLine[], progressMs: number): number {
  let active = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startMs > progressMs) break
    active = i
  }
  return active
}

function trackKey(track: ResolvedTrack): string {
  return [track.maId, track.albumId || 0, normalizeCatalogTitle(track.title), Math.round(track.duration / 2) * 2].join(":")
}

function resultFromRow(track: ResolvedTrack, row: LyricsCacheRow): LyricsResult {
  return {
    videoId: track.videoId,
    kind: row.kind,
    source: "LRCLIB",
    lines: row.kind === "synced" ? parseLrc(row.synced_lyrics) : [],
    text: row.plain_lyrics,
    cachedAt: row.fetched_at,
  }
}

export async function getLyrics(track: ResolvedTrack): Promise<LyricsResult> {
  const key = trackKey(track)
  const cached = db.query("SELECT * FROM lyrics_cache WHERE track_key = ?").get(key) as LyricsCacheRow | undefined
  if (cached) {
    const ttl = cached.kind === "missing" ? MISS_TTL_MS : HIT_TTL_MS
    if (Date.now() - cached.fetched_at < ttl) return resultFromRow(track, cached)
  }

  const params = new URLSearchParams({
    artist_name: track.artist,
    track_name: track.title,
    duration: String(Math.max(1, Math.round(track.duration))),
  })
  if (track.album) params.set("album_name", track.album)
  const response = await fetch(`https://lrclib.net/api/get?${params}`, {
    headers: { "User-Agent": "KMR/1.4.1 (https://github.com/Baulehrer/kmr)" },
    signal: AbortSignal.timeout(12_000),
  })
  const now = Date.now()
  if (response.status === 404) {
    db.run(
      "INSERT OR REPLACE INTO lyrics_cache (track_key, kind, synced_lyrics, plain_lyrics, fetched_at) VALUES (?, 'missing', '', '', ?)",
      [key, now],
    )
    return { videoId: track.videoId, kind: "missing", source: "LRCLIB", lines: [], text: "", cachedAt: now }
  }
  if (!response.ok) throw new Error(`Lyrics service returned HTTP ${response.status}`)

  const payload = await response.json() as { syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean }
  const synced = typeof payload.syncedLyrics === "string" ? payload.syncedLyrics.trim() : ""
  const plain = typeof payload.plainLyrics === "string" ? payload.plainLyrics.trim() : ""
  const lines = parseLrc(synced)
  const kind: LyricsCacheRow["kind"] = lines.length > 0 ? "synced" : plain ? "plain" : "missing"
  db.run(
    "INSERT OR REPLACE INTO lyrics_cache (track_key, kind, synced_lyrics, plain_lyrics, fetched_at) VALUES (?, ?, ?, ?, ?)",
    [key, kind, synced, plain, now],
  )
  return { videoId: track.videoId, kind, source: "LRCLIB", lines, text: plain, cachedAt: now }
}
