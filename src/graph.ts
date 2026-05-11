import { Database } from "bun:sqlite"
import { getSimilarArtists, getCachedSimilar, getCachedArtistByMaId, matchesGenre } from "./ma-client"
import { getAllArtists } from "./library"

const db = new Database("radio_cache.sqlite", { create: true })

db.run(`
  CREATE TABLE IF NOT EXISTS graph_nodes (
    ma_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT,
    updated_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS graph_edges (
    from_ma_id INTEGER NOT NULL,
    to_ma_id INTEGER NOT NULL,
    score INTEGER DEFAULT 0,
    PRIMARY KEY (from_ma_id, to_ma_id)
  )
`)

export async function expandArtist(maId: number): Promise<void> {
  const existing = db.query("SELECT 1 FROM graph_nodes WHERE ma_id = ?").get(maId)
  if (existing) return

  const similar = await getSimilarArtists(maId)

  const detail = getCachedArtistByMaId(maId)
  db.run(
    "INSERT OR REPLACE INTO graph_nodes (ma_id, name, genre, updated_at) VALUES (?, ?, ?, ?)",
    [maId, detail?.name || "", detail?.genre || "", Date.now()]
  )

  for (const sim of similar) {
    db.run(
      "INSERT OR REPLACE INTO graph_edges (from_ma_id, to_ma_id, score) VALUES (?, ?, ?)",
      [maId, sim.maId, sim.score]
    )
    db.run(
      "INSERT OR REPLACE INTO graph_nodes (ma_id, name, genre, updated_at) VALUES (?, ?, ?, ?)",
      [sim.maId, sim.name, sim.genre, Date.now()]
    )
  }
}

export function getSimilar(maId: number): number[] {
  const edges = db
    .query("SELECT to_ma_id, score FROM graph_edges WHERE from_ma_id = ? ORDER BY score DESC")
    .all(maId) as any[]

  if (edges.length === 0) {
    const cached = getCachedSimilar(maId)
    return cached.map((s) => s.maId)
  }

  return edges.map((e) => e.to_ma_id as number)
}

export function getArtistsInGenre(genre: string): number[] {
  const normalized = genre.toLowerCase()

  const fromNodes = db
    .query("SELECT ma_id, genre FROM graph_nodes WHERE genre IS NOT NULL")
    .all() as any[]

  const matched: number[] = []
  for (const row of fromNodes) {
    if (matchesGenre(row.genre, genre)) {
      matched.push(row.ma_id)
    }
  }

  for (const artist of getAllArtists()) {
    if (artist.maId && artist.genres.some((g) => g.toLowerCase().includes(normalized))) {
      if (!matched.includes(artist.maId)) {
        matched.push(artist.maId)
      }
    }
  }

  return matched
}

export function getGraphNode(maId: number): { maId: number; name: string; genre: string } | null {
  const row = db.query("SELECT * FROM graph_nodes WHERE ma_id = ?").get(maId) as any
  if (!row) return null
  return { maId: row.ma_id, name: row.name, genre: row.genre || "" }
}

export function getSimilarWithScores(maId: number): { maId: number; name: string; genre: string; score: number }[] {
  const rows = db
    .query(
      `SELECT e.to_ma_id AS ma_id, n.name, n.genre, e.score
       FROM graph_edges e
       LEFT JOIN graph_nodes n ON n.ma_id = e.to_ma_id
       WHERE e.from_ma_id = ?
       ORDER BY e.score DESC`
    )
    .all(maId) as any[]

  return rows.map((r) => ({
    maId: r.ma_id,
    name: r.name || "",
    genre: r.genre || "",
    score: r.score || 0,
  }))
}

export function getFullGraph(): {
  nodes: { maId: number; name: string; genre: string }[]
  edges: { from: number; to: number; score: number }[]
} {
  const nodes = (db.query("SELECT * FROM graph_nodes").all() as any[]).map((r) => ({
    maId: r.ma_id,
    name: r.name,
    genre: r.genre || "",
  }))

  const edges = (db.query("SELECT * FROM graph_edges").all() as any[]).map((r) => ({
    from: r.from_ma_id,
    to: r.to_ma_id,
    score: r.score,
  }))

  return { nodes, edges }
}
