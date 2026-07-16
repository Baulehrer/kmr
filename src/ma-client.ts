import db, { type MaArtistRow, type MaReleaseRow, type MaSimilarRow, type MaTrackRow } from "./db"
import config from "./radio.config"
import { normalizeName } from "./genre"
import type { MASearchResult, MAArtistDetail, MARelease, MATrack, SimilarArtist } from "./types"

export { parseGenre, matchesGenre } from "./genre"

export const VENV_PYTHON = import.meta.dir + "/../.venv/bin/python3"
export const ADAPTER_SCRIPT = import.meta.dir + "/scrapling_adapter.py"

let lastMaError: { message: string; at: number } | null = null

export function getLastMaError(): { message: string; at: number } | null {
  return lastMaError
}

export function clearLastMaError(): void {
  lastMaError = null
}

function trackMaError(message: string): void {
  lastMaError = { message: message.slice(0, 300), at: Date.now() }
}

const ADAPTER_TIMEOUT_MS = 30_000
const DETAIL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DISCOGRAPHY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

let nextSlotAt = 0

const upsertMaArtist = db.prepare(`
  INSERT INTO ma_artists (ma_id, name, name_key, genre, country, location, formed_in, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(ma_id) DO UPDATE SET
    name = COALESCE(NULLIF(excluded.name, ''), ma_artists.name),
    name_key = COALESCE(NULLIF(excluded.name_key, ''), ma_artists.name_key),
    genre = COALESCE(NULLIF(excluded.genre, ''), ma_artists.genre),
    country = COALESCE(NULLIF(excluded.country, ''), ma_artists.country),
    location = COALESCE(NULLIF(excluded.location, ''), NULLIF(ma_artists.location, '')),
    formed_in = COALESCE(NULLIF(excluded.formed_in, ''), NULLIF(ma_artists.formed_in, '')),
    updated_at = excluded.updated_at
`)

async function acquireSlot(): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextSlotAt)
  nextSlotAt = slot + config.maRateLimit
  const wait = slot - now
  if (wait > 0) await Bun.sleep(wait)
}

export async function runAdapter(command: string, args: string[]): Promise<any> {
  await acquireSlot()

  const proc = Bun.spawn([VENV_PYTHON, ADAPTER_SCRIPT, command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const timer = setTimeout(() => {
    try { proc.kill() } catch {}
  }, ADAPTER_TIMEOUT_MS)

  try {
    const exitCode = await proc.exited
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    if (exitCode !== 0) {
      const msg = `Scrapling adapter failed (exit ${exitCode}): ${stderr.slice(-200)}`
      trackMaError(msg)
      nextSlotAt += 5000 // backoff 5s after error to throttle retries
      throw new Error(msg)
    }

    const raw = stdout.trim()
    try {
      return JSON.parse(raw)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const msg = `Scrapling adapter returned invalid JSON: ${detail}; stderr=${stderr.slice(-200)}`
      trackMaError(msg)
      throw new Error(msg)
    }
  } finally {
    clearTimeout(timer)
  }
}

function fromSearchRow(row: MaArtistRow): MASearchResult {
  return {
    maId: row.ma_id,
    name: row.name,
    genre: row.genre ?? "",
    country: row.country ?? "",
    formedIn: row.formed_in || null,
  }
}

export async function searchArtists(name: string): Promise<MASearchResult[]> {
  const key = normalizeName(name)
  if (!key) return []
  const searchCache = db
    .query("SELECT fetched_at FROM ma_search_cache WHERE name_key = ?")
    .get(key) as { fetched_at: number } | undefined
  if (searchCache && Date.now() - searchCache.fetched_at < SEARCH_CACHE_TTL_MS) {
    return (db
      .query("SELECT * FROM ma_artists WHERE name_key = ? ORDER BY ma_id")
      .all(key) as MaArtistRow[]).map(fromSearchRow)
  }

  const result = await runAdapter("search", [name])
  if (result.error || result.status !== 200 || !Array.isArray(result.parsed)) {
    const msg = `MA search failed for "${name}": ${result.error || `HTTP ${result.status}`}`
    console.warn(msg)
    trackMaError(msg)
    return []
  }

  const parsed = (result.parsed as MASearchResult[]).filter((item) => item?.maId && item?.name)
  const now = Date.now()
  const tx = db.transaction(() => {
    for (const item of parsed) {
      upsertMaArtist.run(
        item.maId,
        item.name,
        normalizeName(item.name),
        item.genre || "",
        item.country || "",
        "",
        item.formedIn || "",
        now,
      )
    }
    db.run("INSERT OR REPLACE INTO ma_search_cache (name_key, fetched_at) VALUES (?, ?)", [key, now])
  })
  tx()
  return parsed
}

export async function searchArtist(name: string): Promise<MASearchResult | null> {
  const key = normalizeName(name)
  const exact = (await searchArtists(name)).filter((item) => normalizeName(item.name) === key)
  return exact.length === 1 ? exact[0]! : null
}

export async function getArtistById(maId: number): Promise<MASearchResult | null> {
  const cached = db.query("SELECT * FROM ma_artists WHERE ma_id = ?").get(maId) as MaArtistRow | undefined
  if (cached) return fromSearchRow(cached)
  const detail = await getArtistDetail(maId)
  return detail ? { ...detail } : null
}

export async function getArtistDetail(maId: number): Promise<MAArtistDetail | null> {
  const cached = db
    .query("SELECT * FROM ma_artists WHERE ma_id = ?")
    .get(maId) as MaArtistRow | undefined

  const fromRow = (row: MaArtistRow): MAArtistDetail => ({
    maId: row.ma_id,
    name: row.name,
    genre: row.genre ?? "",
    country: row.country ?? "",
    location: row.location ?? "",
    formedIn: row.formed_in || null,
  })

  if (cached?.formed_in && Date.now() - cached.updated_at < DETAIL_CACHE_TTL_MS) {
    return fromRow(cached)
  }

  const bandName = cached?.name || ""
  const result = await runAdapter("detail", [String(maId), bandName])
  if (result.error || result.status !== 200) {
    trackMaError(`MA detail failed for ID ${maId}: ${result.error || `HTTP ${result.status}`}`)
    return cached ? fromRow(cached) : null
  }

  const html = result.body as string
  const pick = (re: RegExp) => html.match(re)?.[1]?.trim()
  const genre = pick(/<dt>Genre<\/dt>\s*<dd>([^<]+)<\/dd>/) || cached?.genre || ""
  const country = pick(/<dt>Country of origin<\/dt>\s*<dd>([^<]+)<\/dd>/) || cached?.country || ""
  const location = pick(/<dt>Location<\/dt>\s*<dd>([^<]+)<\/dd>/) || ""
  const formedIn = pick(/<dt>Formed in<\/dt>\s*<dd>([^<]*)<\/dd>/) || null

  upsertMaArtist.run(maId, bandName, normalizeName(bandName), genre, country, location, formedIn || "", Date.now())

  return { maId, name: bandName, genre, country, location, formedIn }
}

export async function getSimilarArtists(maId: number): Promise<SimilarArtist[]> {
  const cached = db
    .query("SELECT * FROM ma_similar WHERE ma_id = ?")
    .all(maId) as MaSimilarRow[]

  if (cached.length > 0) {
    return cached.map((r) => ({
      maId: r.similar_ma_id,
      name: r.similar_name,
      genre: r.similar_genre || "",
      country: r.similar_country || "",
      score: r.score,
    }))
  }

  const result = await runAdapter("similar", [String(maId)])
  if (result.error || result.status !== 200 || !result.parsed) {
    const msg = `MA similar failed for ID ${maId}: ${result.error || `HTTP ${result.status}`}`
    console.warn(msg)
    trackMaError(msg)
    return []
  }

  const similar: SimilarArtist[] = result.parsed
  if (similar.length === 0) return similar

  const insert = db.prepare(
    `INSERT OR REPLACE INTO ma_similar (ma_id, similar_ma_id, similar_name, similar_genre, similar_country, score)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const tx = db.transaction((rows: SimilarArtist[]) => {
    for (const sim of rows) {
      insert.run(maId, sim.maId, sim.name, sim.genre, sim.country, sim.score)
    }
  })
  tx(similar)

  return similar
}

export function normalizeCatalogTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function releasePriority(type: string): number {
  const normalized = type.toLowerCase()
  if (normalized === "full-length") return 0
  if (normalized === "ep") return 1
  if (normalized === "single") return 2
  if (normalized === "demo") return 3
  return 10
}

async function ensureReleases(maId: number): Promise<MaReleaseRow[]> {
  const cached = db
    .query("SELECT * FROM ma_releases WHERE ma_id = ? ORDER BY release_year DESC")
    .all(maId) as MaReleaseRow[]
  const meta = db
    .query("SELECT fetched_at FROM ma_search_cache WHERE name_key = ?")
    .get(`discography:${maId}`) as { fetched_at: number } | undefined
  if (cached.length > 0 && meta && Date.now() - meta.fetched_at < DISCOGRAPHY_CACHE_TTL_MS) return cached

  const result = await runAdapter("discography", [String(maId)])
  if (result.error || result.status !== 200 || !Array.isArray(result.parsed)) {
    console.warn(`MA discography failed for ID ${maId}: ${result.error || `HTTP ${result.status}`}`)
    return cached
  }
  const releases = result.parsed as MARelease[]
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO ma_releases (ma_id, album_id, title, release_type, release_year, tracks_fetched_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(ma_id, album_id) DO UPDATE SET
       title = excluded.title, release_type = excluded.release_type, release_year = excluded.release_year`,
  )
  const tx = db.transaction(() => {
    for (const release of releases) insert.run(maId, release.albumId, release.title, release.type, release.year)
    db.run("INSERT OR REPLACE INTO ma_search_cache (name_key, fetched_at) VALUES (?, ?)", [`discography:${maId}`, now])
  })
  tx()
  return db.query("SELECT * FROM ma_releases WHERE ma_id = ? ORDER BY release_year DESC").all(maId) as MaReleaseRow[]
}

async function fetchReleaseTracks(release: MaReleaseRow): Promise<void> {
  const result = await runAdapter("release-tracks", [String(release.ma_id), String(release.album_id)])
  const now = Date.now()
  if (result.error || result.status !== 200 || !Array.isArray(result.parsed)) {
    console.warn(`MA tracklist failed for release ${release.album_id}: ${result.error || `HTTP ${result.status}`}`)
    return
  }
  const tracks = result.parsed as MATrack[]
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ma_tracks (ma_id, album_id, album_title, title, title_key, duration)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction(() => {
    for (const track of tracks) {
      const key = normalizeCatalogTitle(track.title)
      if (key) insert.run(release.ma_id, release.album_id, track.album || release.title, track.title, key, track.duration || 0)
    }
    db.run("UPDATE ma_releases SET tracks_fetched_at = ? WHERE ma_id = ? AND album_id = ?", [now, release.ma_id, release.album_id])
  })
  tx()
}

export async function getDiscographyTracks(maId: number, targetCount = 12, fetchBudget = 2): Promise<MATrack[]> {
  const releases = await ensureReleases(maId)
  let rows = db.query("SELECT * FROM ma_tracks WHERE ma_id = ?").all(maId) as MaTrackRow[]
  if (rows.length < targetCount) {
    const preferred = releases
      .filter((release) => releasePriority(release.release_type) < 10 && !release.tracks_fetched_at)
      .sort((a, b) => releasePriority(a.release_type) - releasePriority(b.release_type))
      .slice(0, Math.max(0, fetchBudget))
    for (const release of preferred) await fetchReleaseTracks(release)
    rows = db.query("SELECT * FROM ma_tracks WHERE ma_id = ?").all(maId) as MaTrackRow[]
  }
  return rows.map((row) => ({
    maId: row.ma_id,
    albumId: row.album_id,
    album: row.album_title,
    title: row.title,
    duration: row.duration,
  }))
}

export function getCachedArtistByMaId(maId: number): MAArtistDetail | null {
  const row = db.query("SELECT * FROM ma_artists WHERE ma_id = ?").get(maId) as MaArtistRow | undefined
  if (!row) return null
  return {
    maId: row.ma_id,
    name: row.name,
    genre: row.genre ?? "",
    country: row.country ?? "",
    location: row.location ?? "",
    formedIn: row.formed_in || null,
  }
}

export function getCachedSimilar(maId: number): SimilarArtist[] {
  const rows = db.query("SELECT * FROM ma_similar WHERE ma_id = ?").all(maId) as MaSimilarRow[]
  return rows.map((r) => ({
    maId: r.similar_ma_id,
    name: r.similar_name,
    genre: r.similar_genre || "",
    country: r.similar_country || "",
    score: r.score,
  }))
}
