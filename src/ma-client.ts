import { Database } from "bun:sqlite"
import config from "./radio.config"
import type { MASearchResult, MAArtistDetail, SimilarArtist } from "./types"

const db = new Database("radio_cache.sqlite", { create: true })

db.run(`
  CREATE TABLE IF NOT EXISTS ma_artists (
    ma_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT,
    country TEXT,
    location TEXT,
    formed_in TEXT,
    updated_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS ma_similar (
    ma_id INTEGER NOT NULL,
    similar_ma_id INTEGER NOT NULL,
    similar_name TEXT NOT NULL,
    similar_genre TEXT,
    similar_country TEXT,
    score INTEGER DEFAULT 0,
    PRIMARY KEY (ma_id, similar_ma_id)
  )
`)

let lastRequestTime = 0

const VENV_PYTHON = import.meta.dir + "/../.venv/bin/python3"
const ADAPTER_SCRIPT = import.meta.dir + "/scrapling_adapter.py"

async function runAdapter(command: string, args: string[]): Promise<any> {
  const now = Date.now()
  const wait = config.maRateLimit - (now - lastRequestTime)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestTime = Date.now()

  const proc = Bun.spawn([VENV_PYTHON, ADAPTER_SCRIPT, command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  if (exitCode !== 0) {
    throw new Error(`Scrapling adapter failed (exit ${exitCode}): ${stderr.slice(-200)}`)
  }

  return JSON.parse(stdout.trim())
}

function parseGenre(raw: string): string[] {
  return raw
    .split("/")
    .map((g) => g.trim())
    .filter(Boolean)
}

export async function searchArtist(name: string): Promise<MASearchResult | null> {
  const cached = db
    .query("SELECT * FROM ma_artists WHERE name = ? LIMIT 1")
    .get(name) as any
  if (cached) {
    return {
      maId: cached.ma_id,
      name: cached.name,
      genre: cached.genre,
      country: cached.country,
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
  const genre: string = parsed.genre || ""
  const country: string = parsed.country || ""

  db.run(
    `INSERT OR REPLACE INTO ma_artists (ma_id, name, genre, country, location, formed_in, updated_at)
     VALUES (?, ?, ?, ?, '', '', ?)`,
    [maId, name, genre, country, Date.now()]
  )

  return { maId, name, genre, country }
}

export async function getArtistDetail(maId: number): Promise<MAArtistDetail | null> {
  const cached = db
    .query("SELECT * FROM ma_artists WHERE ma_id = ?")
    .get(maId) as any
  if (cached && cached.location !== undefined && Date.now() - cached.updated_at < 86400000) {
    return {
      maId: cached.ma_id,
      name: cached.name,
      genre: cached.genre,
      country: cached.country,
      location: cached.location,
      formedIn: cached.formed_in,
    }
  }

  const bandName = cached?.name || ""
  const result = await runAdapter("detail", [String(maId), bandName])
  if (result.error || result.status !== 200) {
    return cached ? {
      maId: cached.ma_id,
      name: cached.name,
      genre: cached.genre,
      country: cached.country,
      location: cached.location,
      formedIn: cached.formed_in,
    } : null
  }

  const html = result.body as string
  const genreMatch = html.match(/<dt>Genre<\/dt>\s*<dd>([^<]+)<\/dd>/)
  const countryMatch = html.match(/<dt>Country of origin<\/dt>\s*<dd>([^<]+)<\/dd>/)
  const locationMatch = html.match(/<dt>Location<\/dt>\s*<dd>([^<]+)<\/dd>/)
  const formedMatch = html.match(/<dt>Formed in<\/dt>\s*<dd>([^<]*)<\/dd>/)

  const genre = genreMatch?.[1]?.trim() || cached?.genre || ""
  const country = countryMatch?.[1]?.trim() || cached?.country || ""
  const location = locationMatch?.[1]?.trim() || ""
  const formedIn = formedMatch?.[1]?.trim() || null

  db.run(
    `INSERT OR REPLACE INTO ma_artists (ma_id, name, genre, country, location, formed_in, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [maId, bandName, genre, country, location, formedIn || "", Date.now()]
  )

  return { maId, name: bandName, genre, country, location, formedIn }
}

export async function getSimilarArtists(maId: number): Promise<SimilarArtist[]> {
  const cached = db
    .query("SELECT * FROM ma_similar WHERE ma_id = ?")
    .all(maId) as any[]

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

  for (const sim of similar) {
    db.run(
      `INSERT OR REPLACE INTO ma_similar (ma_id, similar_ma_id, similar_name, similar_genre, similar_country, score)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [maId, sim.maId, sim.name, sim.genre, sim.country, sim.score]
    )
  }

  return similar
}

export function getCachedArtistByMaId(maId: number): MAArtistDetail | null {
  const row = db.query("SELECT * FROM ma_artists WHERE ma_id = ?").get(maId) as any
  if (!row) return null
  return {
    maId: row.ma_id,
    name: row.name,
    genre: row.genre,
    country: row.country,
    location: row.location,
    formedIn: row.formed_in,
  }
}

export function getCachedSimilar(maId: number): SimilarArtist[] {
  const rows = db.query("SELECT * FROM ma_similar WHERE ma_id = ?").all(maId) as any[]
  return rows.map((r) => ({
    maId: r.similar_ma_id,
    name: r.similar_name,
    genre: r.similar_genre || "",
    country: r.similar_country || "",
    score: r.score,
  }))
}

export function matchesGenre(artistGenres: string, targetGenre: string): boolean {
  const normalized = targetGenre.toLowerCase()
  return parseGenre(artistGenres).some((g) => g.toLowerCase().includes(normalized))
}
