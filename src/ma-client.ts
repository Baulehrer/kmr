import db, { type ArtworkCacheRow, type MaArtistRow, type MaMemberRow, type MaReleaseRow, type MaSimilarRow, type MaTrackRow } from "./db"
import config from "./radio.config"
import { matchesDecade, normalizeName, parseDecade } from "./genre"
import type { MASearchResult, MAArtistDetail, MAMember, MARelease, MATrack, SimilarArtist, ReleaseTypeFilter, Decade } from "./types"

export { parseGenre, matchesGenre } from "./genre"

export function releaseTypeGroup(value: string): ReleaseTypeFilter {
  const type = value.trim().toLowerCase()
  if (type.includes("full-length")) return "studio"
  if (type === "ep" || type.includes("extended play")) return "ep"
  if (type.includes("live")) return "live"
  if (type.includes("demo")) return "demo"
  if (type.includes("single")) return "single"
  return "other"
}

export const VENV_PYTHON = import.meta.dir + "/../.venv/bin/python3"
export const ADAPTER_SCRIPT = import.meta.dir + "/scrapling_adapter.py"

let lastMaError: { message: string; at: number } | null = null

export function getLastMaError(): { message: string; at: number } | null {
  return lastMaError
}

export function clearLastMaError(): void {
  lastMaError = null
}

/** Packaged adapters may print dependency logs before their one-line JSON result. */
export function parseAdapterOutput(stdout: string): any {
  const raw = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith("{"))
    ?.trim()
  if (!raw) throw new Error("no JSON object found")
  return JSON.parse(raw)
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

  const packagedAdapter = process.env.KMR_MA_ADAPTER
  const argv = packagedAdapter
    ? [packagedAdapter, command, ...args]
    : [VENV_PYTHON, ADAPTER_SCRIPT, command, ...args]
  const proc = Bun.spawn(argv, {
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

    try {
      return parseAdapterOutput(stdout)
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

export async function searchArtistsBroad(name: string): Promise<MASearchResult[]> {
  const key = `browser:${normalizeName(name)}`
  if (key === "browser:") return []
  const cachedAt = db.query("SELECT MAX(fetched_at) AS fetched_at FROM ma_browser_search WHERE query_key = ?").get(key) as { fetched_at: number | null }
  if (cachedAt.fetched_at && Date.now() - cachedAt.fetched_at < SEARCH_CACHE_TTL_MS) {
    return (db.query(
      `SELECT a.* FROM ma_browser_search s JOIN ma_artists a ON a.ma_id = s.ma_id
       WHERE s.query_key = ? ORDER BY a.name, a.ma_id`,
    ).all(key) as MaArtistRow[]).map(fromSearchRow)
  }
  const result = await runAdapter("search-all", [name])
  if (result.error || result.status !== 200 || !Array.isArray(result.parsed)) return []
  const parsed = (result.parsed as MASearchResult[]).filter((item) => item?.maId && item?.name)
  const now = Date.now()
  const tx = db.transaction(() => {
    db.run("DELETE FROM ma_browser_search WHERE query_key = ?", [key])
    for (const item of parsed) {
      upsertMaArtist.run(item.maId, item.name, normalizeName(item.name), item.genre || "", item.country || "", "", item.formedIn || "", now)
      db.run("INSERT INTO ma_browser_search (query_key, ma_id, fetched_at) VALUES (?, ?, ?)", [key, item.maId, now])
    }
  })
  tx()
  return parsed
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

  const membersFromDb = (): MAMember[] => (db
    .query("SELECT * FROM ma_members WHERE ma_id = ? ORDER BY member_kind, name")
    .all(maId) as MaMemberRow[]).map((member) => ({ name: member.name, role: member.role, kind: member.member_kind }))
  const fromRow = (row: MaArtistRow): MAArtistDetail => ({
    maId: row.ma_id,
    name: row.name,
    genre: row.genre ?? "",
    country: row.country ?? "",
    location: row.location ?? "",
    formedIn: row.formed_in || null,
    status: row.status || "",
    yearsActive: row.years_active || "",
    themes: row.themes || "",
    label: row.label || "",
    logoUrl: row.logo_url || "",
    photoUrl: row.photo_url || "",
    members: membersFromDb(),
  })

  if (cached?.formed_in && cached.status && Date.now() - cached.updated_at < DETAIL_CACHE_TTL_MS) {
    return fromRow(cached)
  }

  const bandName = cached?.name || ""
  const result = await runAdapter("detail", [String(maId), bandName])
  if (result.error || result.status !== 200) {
    trackMaError(`MA detail failed for ID ${maId}: ${result.error || `HTTP ${result.status}`}`)
    return cached ? fromRow(cached) : null
  }

  const parsed = result.parsed as MAArtistDetail | undefined
  if (!parsed) return cached ? fromRow(cached) : null
  const detail: MAArtistDetail = {
    maId,
    name: parsed.name || bandName,
    genre: parsed.genre || cached?.genre || "",
    country: parsed.country || cached?.country || "",
    location: parsed.location || "",
    formedIn: parsed.formedIn || null,
    status: parsed.status || "",
    yearsActive: parsed.yearsActive || "",
    themes: parsed.themes || "",
    label: parsed.label || "",
    logoUrl: parsed.logoUrl || "",
    photoUrl: parsed.photoUrl || "",
    members: Array.isArray(parsed.members) ? parsed.members : [],
  }
  const now = Date.now()
  const tx = db.transaction(() => {
    upsertMaArtist.run(maId, detail.name, normalizeName(detail.name), detail.genre, detail.country, detail.location, detail.formedIn || "", now)
    db.run(
      `UPDATE ma_artists SET status = ?, years_active = ?, themes = ?, label = ?, logo_url = ?, photo_url = ? WHERE ma_id = ?`,
      [detail.status, detail.yearsActive, detail.themes, detail.label, detail.logoUrl, detail.photoUrl, maId],
    )
    db.run("DELETE FROM ma_members WHERE ma_id = ?", [maId])
    for (const member of detail.members) {
      db.run("INSERT OR IGNORE INTO ma_members (ma_id, name, role, member_kind) VALUES (?, ?, ?, ?)", [maId, member.name, member.role, member.kind])
    }
  })
  tx()
  return detail
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
  const detail = result.release as MARelease | undefined
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ma_tracks (ma_id, album_id, album_title, title, title_key, duration)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction(() => {
    for (const track of tracks) {
      const key = normalizeCatalogTitle(track.title)
      if (key) insert.run(release.ma_id, release.album_id, track.album || release.title, track.title, key, track.duration || 0)
    }
    if (detail) {
      db.run(
        `UPDATE ma_releases SET cover_url = ?, release_date = ?, label = ?, catalog_id = ?, format = ?, rating = ?, review_count = ?
         WHERE ma_id = ? AND album_id = ?`,
        [detail.coverUrl || "", detail.releaseDate || "", detail.label || "", detail.catalogId || "", detail.format || "", detail.rating ?? 0, detail.reviewCount ?? 0, release.ma_id, release.album_id],
      )
    }
    db.run("UPDATE ma_releases SET tracks_fetched_at = ? WHERE ma_id = ? AND album_id = ?", [now, release.ma_id, release.album_id])
  })
  tx()
}

function releaseFromRow(row: MaReleaseRow): MARelease {
  return {
    maId: row.ma_id,
    albumId: row.album_id,
    title: row.title,
    type: row.release_type,
    year: row.release_year,
    coverUrl: row.cover_url || "",
    releaseDate: row.release_date || "",
    label: row.label || "",
    catalogId: row.catalog_id || "",
    format: row.format || "",
    rating: row.rating >= 0 ? row.rating : undefined,
    reviewCount: row.review_count,
  }
}

export async function getArtistDiscography(maId: number): Promise<MARelease[]> {
  if (!Number.isInteger(maId) || maId <= 0) return []
  return (await ensureReleases(maId)).map(releaseFromRow)
}

export async function getReleaseDetail(maId: number, albumId: number): Promise<{ release: MARelease; tracks: MATrack[] } | null> {
  const releases = await ensureReleases(maId)
  let release = releases.find((item) => item.album_id === albumId)
  if (!release) return null
  if (!release.tracks_fetched_at || !release.cover_url || release.rating < 0) {
    await fetchReleaseTracks(release)
    release = db.query("SELECT * FROM ma_releases WHERE ma_id = ? AND album_id = ?").get(maId, albumId) as MaReleaseRow | undefined
    if (!release) return null
  }
  const rows = db.query("SELECT * FROM ma_tracks WHERE ma_id = ? AND album_id = ? ORDER BY rowid").all(maId, albumId) as MaTrackRow[]
  return {
    release: releaseFromRow(release),
    tracks: rows.map((row) => ({ maId, albumId, album: row.album_title, title: row.title, duration: row.duration })),
  }
}

export async function getMaArtwork(urlValue: string): Promise<{ contentType: string; body: Uint8Array } | null> {
  let url: URL
  try { url = new URL(urlValue) } catch { return null }
  if (url.protocol !== "https:" || !(url.hostname === "metal-archives.com" || url.hostname.endsWith(".metal-archives.com"))) return null
  const cached = db.query("SELECT * FROM artwork_cache WHERE url = ?").get(url.href) as ArtworkCacheRow | undefined
  if (cached && Date.now() - cached.fetched_at < 30 * 24 * 60 * 60 * 1000) {
    return { contentType: cached.content_type, body: cached.body }
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  const contentType = response.headers.get("content-type")?.split(";")[0] || ""
  const size = Number(response.headers.get("content-length") || 0)
  if (!response.ok || !contentType.startsWith("image/") || size > 8 * 1024 * 1024) return null
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > 8 * 1024 * 1024) return null
  db.run("INSERT OR REPLACE INTO artwork_cache (url, content_type, body, fetched_at) VALUES (?, ?, ?, ?)", [url.href, contentType, body, Date.now()])
  return { contentType, body }
}

export async function getDiscographyTracks(
  maId: number,
  targetCount = 12,
  fetchBudget = 2,
  releaseTypes?: ReleaseTypeFilter[],
  decades: Decade[] = [],
): Promise<MATrack[]> {
  const releases = await ensureReleases(maId)
  const allowed = releaseTypes?.length ? new Set(releaseTypes) : null
  const matchesRelease = (type: string) => !allowed || allowed.has(releaseTypeGroup(type))
  const matchesYear = (year: string) => decades.length === 0 || matchesDecade(parseDecade(year), decades)
  let rows = db.query(
    `SELECT t.*, r.release_type, r.release_year FROM ma_tracks t
     JOIN ma_releases r ON r.ma_id = t.ma_id AND r.album_id = t.album_id
     WHERE t.ma_id = ?`,
  ).all(maId) as MaTrackRow[]
  rows = rows.filter((row) => matchesRelease(row.release_type || "") && matchesYear(row.release_year || ""))
  if (rows.length < targetCount) {
    const preferred = releases
      .filter((release) => matchesRelease(release.release_type) && matchesYear(release.release_year) && !release.tracks_fetched_at)
      .sort((a, b) => releasePriority(a.release_type) - releasePriority(b.release_type))
      .slice(0, Math.max(0, fetchBudget))
    for (const release of preferred) await fetchReleaseTracks(release)
    rows = (db.query(
      `SELECT t.*, r.release_type, r.release_year FROM ma_tracks t
       JOIN ma_releases r ON r.ma_id = t.ma_id AND r.album_id = t.album_id
       WHERE t.ma_id = ?`,
    ).all(maId) as MaTrackRow[]).filter((row) => matchesRelease(row.release_type || "") && matchesYear(row.release_year || ""))
  }
  return rows.map((row) => ({
    maId: row.ma_id,
    albumId: row.album_id,
    album: row.album_title,
    title: row.title,
    duration: row.duration,
    releaseType: row.release_type,
    releaseYear: row.release_year,
  }))
}

export function getCachedArtistByMaId(maId: number): MAArtistDetail | null {
  const row = db.query("SELECT * FROM ma_artists WHERE ma_id = ?").get(maId) as MaArtistRow | undefined
  if (!row) return null
  const members = (db.query("SELECT * FROM ma_members WHERE ma_id = ? ORDER BY member_kind, name").all(maId) as MaMemberRow[])
  return {
    maId: row.ma_id,
    name: row.name,
    genre: row.genre ?? "",
    country: row.country ?? "",
    location: row.location ?? "",
    formedIn: row.formed_in || null,
    status: row.status || "",
    yearsActive: row.years_active || "",
    themes: row.themes || "",
    label: row.label || "",
    logoUrl: row.logo_url || "",
    photoUrl: row.photo_url || "",
    members: members.map((member) => ({ name: member.name, role: member.role, kind: member.member_kind })),
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
