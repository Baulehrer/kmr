import db, { type MaArtistRow, type MaSimilarRow } from "./db"
import config from "./radio.config"
import { normalizeName } from "./genre"
import type { MASearchResult, MAArtistDetail, SimilarArtist } from "./types"

export { parseGenre, matchesGenre } from "./genre"

export const VENV_PYTHON = import.meta.dir + "/../.venv/bin/python3"
export const ADAPTER_SCRIPT = import.meta.dir + "/scrapling_adapter.py"

const ADAPTER_TIMEOUT_MS = 30_000
const DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000

let nextSlotAt = 0

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
      throw new Error(`Scrapling adapter failed (exit ${exitCode}): ${stderr.slice(-200)}`)
    }

    return JSON.parse(stdout.trim())
  } finally {
    clearTimeout(timer)
  }
}

export async function searchArtist(name: string): Promise<MASearchResult | null> {
  const key = normalizeName(name)
  const cached = db
    .query("SELECT * FROM ma_artists WHERE name_key = ? LIMIT 1")
    .get(key) as MaArtistRow | undefined
  if (cached) {
    return {
      maId: cached.ma_id,
      name: cached.name,
      genre: cached.genre ?? "",
      country: cached.country ?? "",
    }
  }

  const result = await runAdapter("search", [name])
  if (result.error || result.status !== 200 || !result.parsed) {
    console.warn(`MA search failed for "${name}": ${result.error || `HTTP ${result.status}`}`)
    return null
  }

  const parsed = result.parsed
  if (!parsed.maId) return null

  const maId: number = parsed.maId
  const resolvedName: string = parsed.name || name
  const genre: string = parsed.genre || ""
  const country: string = parsed.country || ""

  db.run(
    `INSERT OR REPLACE INTO ma_artists (ma_id, name, name_key, genre, country, location, formed_in, updated_at)
     VALUES (?, ?, ?, ?, ?, '', '', ?)`,
    [maId, resolvedName, key, genre, country, Date.now()]
  )

  return { maId, name: resolvedName, genre, country }
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

  if (cached && cached.location && Date.now() - cached.updated_at < DETAIL_CACHE_TTL_MS) {
    return fromRow(cached)
  }

  const bandName = cached?.name || ""
  const result = await runAdapter("detail", [String(maId), bandName])
  if (result.error || result.status !== 200) {
    return cached ? fromRow(cached) : null
  }

  const html = result.body as string
  const pick = (re: RegExp) => html.match(re)?.[1]?.trim()
  const genre = pick(/<dt>Genre<\/dt>\s*<dd>([^<]+)<\/dd>/) || cached?.genre || ""
  const country = pick(/<dt>Country of origin<\/dt>\s*<dd>([^<]+)<\/dd>/) || cached?.country || ""
  const location = pick(/<dt>Location<\/dt>\s*<dd>([^<]+)<\/dd>/) || ""
  const formedIn = pick(/<dt>Formed in<\/dt>\s*<dd>([^<]*)<\/dd>/) || null

  db.run(
    `INSERT OR REPLACE INTO ma_artists (ma_id, name, name_key, genre, country, location, formed_in, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [maId, bandName, normalizeName(bandName), genre, country, location, formedIn || "", Date.now()]
  )

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
    console.warn(`MA similar failed for ID ${maId}: ${result.error || `HTTP ${result.status}`}`)
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
