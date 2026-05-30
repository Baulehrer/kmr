import db, { type HistoryRow } from "./db"
import { normalizeName } from "./genre"
import type { QueueItem, ResolvedTrack } from "./types"

const queue: QueueItem[] = []
const recentArtists: string[] = []

function pushRecent(artist: string): void {
  const key = normalizeName(artist)
  const idx = recentArtists.indexOf(key)
  if (idx !== -1) recentArtists.splice(idx, 1)
  recentArtists.push(key)
}

export function initRecentArtists(maxRecent: number): void {
  recentArtists.length = 0
  // Fetch more than maxRecent to account for deduplication
  const rows = db
    .query("SELECT artist FROM history ORDER BY played_at DESC LIMIT ?")
    .all(maxRecent * 3) as Pick<HistoryRow, "artist">[]
  for (const r of rows) {
    if (!r.artist) continue
    const key = normalizeName(r.artist)
    if (recentArtists.includes(key)) continue
    recentArtists.unshift(key)
    if (recentArtists.length >= maxRecent) break
  }
}

export function isRecentArtist(artist: string, maxRecent: number): boolean {
  if (maxRecent <= 0) return false
  const key = normalizeName(artist)
  const idx = recentArtists.indexOf(key)
  if (idx === -1) return false
  return recentArtists.length - idx <= maxRecent
}

export function trimRecentArtists(maxSize: number): void {
  while (recentArtists.length > maxSize) {
    recentArtists.shift()
  }
}

export function isDuplicate(track: ResolvedTrack, repeatProtection: number): boolean {
  if (isRecentArtist(track.artist, repeatProtection)) return true
  const artistKey = normalizeName(track.artist)
  for (const item of queue) {
    if (item.track.videoId === track.videoId) return true
    if (normalizeName(item.track.artist) === artistKey) return true
  }
  return false
}

export function enqueue(track: ResolvedTrack): void {
  queue.push({
    track,
    scheduledAt: Date.now(),
    playedAt: null,
  })
}

export function dequeue(): QueueItem | undefined {
  return queue.shift()
}

export function getQueue(): QueueItem[] {
  return [...queue]
}

export function getQueueSize(): number {
  return queue.length
}

export function getQueuedVideoIds(): string[] {
  return queue.map((item) => item.track.videoId)
}

export function clearQueue(): void {
  queue.length = 0
}

export function findQueuedByVideoId(videoId: string): { track: ResolvedTrack; index: number } | null {
  const idx = queue.findIndex((q) => q.track.videoId === videoId)
  if (idx === -1) return null
  return { track: queue[idx]!.track, index: idx }
}

export function dropQueueUpTo(index: number): void {
  if (index <= 0) return
  queue.splice(0, index)
}

export function prepend(track: ResolvedTrack): void {
  queue.unshift({ track, scheduledAt: Date.now(), playedAt: null })
}

export function addToHistory(track: ResolvedTrack): void {
  db.run(
    "INSERT INTO history (video_id, title, artist, genre, country, duration, source, similar_to, played_at, hops_from_anchor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      track.videoId,
      track.title,
      track.artist,
      track.genre,
      track.country,
      track.duration,
      track.source,
      track.similarTo || null,
      Date.now(),
      track.hopsFromAnchor ?? null,
    ]
  )
  pushRecent(track.artist)
}

export function getHistory(limit = 50): ResolvedTrack[] {
  const rows = db
    .query("SELECT * FROM history ORDER BY played_at DESC LIMIT ?")
    .all(limit) as HistoryRow[]

  return rows.map((r) => ({
    videoId: r.video_id,
    title: r.title ?? "",
    artist: r.artist ?? "",
    genre: r.genre ?? "",
    country: r.country ?? "",
    duration: r.duration,
    source: (r.source ?? "library") as ResolvedTrack["source"],
    similarTo: r.similar_to || undefined,
    hopsFromAnchor: r.hops_from_anchor ?? undefined,
  }))
}

export function getRecentVideoIds(limit = 100): string[] {
  const rows = db
    .query("SELECT video_id FROM history ORDER BY played_at DESC LIMIT ?")
    .all(limit) as Pick<HistoryRow, "video_id">[]
  return rows.map((r) => r.video_id).filter(Boolean)
}
