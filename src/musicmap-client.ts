import db, { type MmArtistRow, type MmSimilarRow } from "./db"
import { runAdapter } from "./ma-client"

const MM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface MMSimilarArtist {
  name: string
  score: number
}

export function musicMapSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "+")
}

function loadCached(slug: string): MMSimilarArtist[] | null {
  const meta = db
    .query("SELECT * FROM mm_artists WHERE slug = ?")
    .get(slug) as MmArtistRow | undefined
  if (!meta) return null
  if (Date.now() - meta.last_fetched >= MM_CACHE_TTL_MS) return null
  const rows = db
    .query("SELECT * FROM mm_similar WHERE from_slug = ? ORDER BY score DESC")
    .all(slug) as MmSimilarRow[]
  return rows.map((r) => ({ name: r.to_name, score: r.score }))
}

export async function getMusicMapSimilar(query: string): Promise<MMSimilarArtist[]> {
  const slug = musicMapSlug(query)
  const cached = loadCached(slug)
  if (cached !== null) return cached

  let result: any
  try {
    result = await runAdapter("musicmap-similar", [query])
  } catch (err: any) {
    console.warn(`music-map fetch failed for "${query}":`, err.message)
    return []
  }
  const similar = (Array.isArray(result?.parsed) ? result.parsed : []) as MMSimilarArtist[]

  const tx = db.transaction(() => {
    db.run(
      "INSERT OR REPLACE INTO mm_artists (slug, name, last_fetched) VALUES (?, ?, ?)",
      [slug, query, Date.now()],
    )
    db.run("DELETE FROM mm_similar WHERE from_slug = ?", [slug])
    if (similar.length === 0) return
    const insert = db.prepare(
      "INSERT OR REPLACE INTO mm_similar (from_slug, to_slug, to_name, score) VALUES (?, ?, ?, ?)",
    )
    for (const sim of similar) {
      if (!sim?.name) continue
      const toSlug = musicMapSlug(sim.name)
      insert.run(slug, toSlug, sim.name, Math.max(1, Math.min(100, sim.score || 1)))
    }
  })
  tx()

  return similar
}

export function hasMusicMapData(query: string): boolean {
  const slug = musicMapSlug(query)
  const row = db.query("SELECT 1 FROM mm_artists WHERE slug = ?").get(slug)
  return !!row
}
