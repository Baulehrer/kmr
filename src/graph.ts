import db, { type GraphNodeRow, type GraphEdgeRow, type GraphEdgeWithNodeRow } from "./db"
import { getSimilarArtists, getCachedArtistByMaId, getArtistDetail } from "./ma-client"
import { matchesGenre, parseDecade } from "./genre"
import { getAllArtists } from "./library"

const upsertNode = db.prepare(
  "INSERT OR REPLACE INTO graph_nodes (ma_id, name, genre, country, updated_at, formed_in, decade, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
)
const upsertEdge = db.prepare(
  "INSERT OR REPLACE INTO graph_edges (from_ma_id, to_ma_id, score) VALUES (?, ?, ?)"
)

export async function expandArtist(maId: number): Promise<void> {
  const hasEdges = db
    .query("SELECT 1 FROM graph_edges WHERE from_ma_id = ? LIMIT 1")
    .get(maId)
  if (hasEdges) return

  const similar = await getSimilarArtists(maId)
  let detail = getCachedArtistByMaId(maId)
  if (!detail?.formedIn) {
    try {
      const fetched = await getArtistDetail(maId)
      if (fetched) detail = fetched
    } catch {}
  }
  const now = Date.now()
  const decade = parseDecade(detail?.formedIn)

  const tx = db.transaction(() => {
    upsertNode.run(
      maId,
      detail?.name || "",
      detail?.genre || "",
      detail?.country || "",
      now,
      detail?.formedIn || null,
      decade,
      "ma",
    )
    for (const sim of similar) {
      upsertEdge.run(maId, sim.maId, sim.score)
      upsertNode.run(sim.maId, sim.name, sim.genre, sim.country || "", now, null, null, "ma")
    }
  })
  tx()
}

export function upsertGraphNode(node: {
  maId: number
  name: string
  genre?: string
  country?: string
  formedIn?: string | null
  source?: string
}): void {
  const decade = node.formedIn ? parseDecade(node.formedIn) : null
  upsertNode.run(
    node.maId,
    node.name,
    node.genre || "",
    node.country || "",
    Date.now(),
    node.formedIn ?? null,
    decade,
    node.source || "ma",
  )
}

export function getGraphNodeByName(name: string): GraphNodeRow | null {
  const row = db
    .query("SELECT * FROM graph_nodes WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1")
    .get(name) as GraphNodeRow | undefined
  return row ?? null
}

export type NeighborLookup = (id: number) => { id: number; score: number }[]

/**
 * Pure BFS: starting at `anchorId`, walks the adjacency provided by
 * `getNeighbors` up to `maxHops` hops. Returns each visited node (excluding the
 * anchor) with its minimum hop distance and the best path score along the
 * highest-scoring path of that length. Path score is the product of edge
 * scores normalized to 0..1, so closer & stronger paths score higher.
 */
export function bfsNeighborhood(
  anchorId: number,
  maxHops: 1 | 2 | 3,
  getNeighbors: NeighborLookup,
): Map<number, { hops: number; aggregateScore: number }> {
  const result = new Map<number, { hops: number; aggregateScore: number }>()
  let frontier: Array<{ id: number; score: number }> = [{ id: anchorId, score: 1 }]
  const bestScore = new Map<number, number>([[anchorId, 1]])

  for (let hop = 1; hop <= maxHops; hop++) {
    if (frontier.length === 0) break
    const nextFrontier = new Map<number, number>()
    for (const { id, score } of frontier) {
      for (const n of getNeighbors(id)) {
        if (n.id === anchorId) continue
        const edgeScore = Math.max(0, n.score) / 100
        const pathScore = score * Math.max(0.01, edgeScore)
        const existing = result.get(n.id)
        if (!existing) {
          result.set(n.id, { hops: hop, aggregateScore: pathScore })
        } else if (existing.hops === hop && pathScore > existing.aggregateScore) {
          existing.aggregateScore = pathScore
        }
        const seen = bestScore.get(n.id) ?? -1
        if (pathScore > seen) {
          bestScore.set(n.id, pathScore)
          nextFrontier.set(n.id, pathScore)
        }
      }
    }
    frontier = [...nextFrontier.entries()].map(([id, score]) => ({ id, score }))
  }

  return result
}

function neighborsFromDb(id: number): { id: number; score: number }[] {
  return db
    .query(
      `SELECT to_ma_id AS id, score FROM graph_edges WHERE from_ma_id = ?
       UNION
       SELECT from_ma_id AS id, score FROM graph_edges WHERE to_ma_id = ?`,
    )
    .all(id, id) as { id: number; score: number }[]
}

/**
 * Bidirectional BFS over `graph_edges`. Returns every node reachable from
 * `anchorId` within `maxHops` hops, excluding the anchor itself.
 */
export function getNeighborhood(
  anchorId: number,
  maxHops: 1 | 2 | 3,
): Map<number, { hops: number; aggregateScore: number }> {
  return bfsNeighborhood(anchorId, maxHops, neighborsFromDb)
}

export function getNodesByIds(maIds: number[]): GraphNodeRow[] {
  if (maIds.length === 0) return []
  const placeholders = maIds.map(() => "?").join(",")
  return db
    .query(`SELECT * FROM graph_nodes WHERE ma_id IN (${placeholders})`)
    .all(...maIds) as GraphNodeRow[]
}

export function getArtistsInGenre(genre: string): number[] {
  const matched = new Set<number>()

  const rows = db
    .query("SELECT ma_id, genre FROM graph_nodes WHERE genre IS NOT NULL AND genre != ''")
    .all() as Pick<GraphNodeRow, "ma_id" | "genre">[]
  for (const row of rows) {
    if (row.genre && matchesGenre(row.genre, genre)) matched.add(row.ma_id)
  }

  for (const artist of getAllArtists()) {
    if (artist.maId && matchesGenre(artist.genres, genre)) {
      matched.add(artist.maId)
    }
  }

  return [...matched]
}

export function getGraphNode(maId: number): { maId: number; name: string; genre: string; country: string } | null {
  const row = db
    .query("SELECT * FROM graph_nodes WHERE ma_id = ?")
    .get(maId) as GraphNodeRow | undefined
  if (!row) return null
  return { maId: row.ma_id, name: row.name, genre: row.genre ?? "", country: row.country ?? "" }
}

export function getSimilarWithScores(maId: number): { maId: number; name: string; genre: string; country: string; score: number }[] {
  const rows = db
    .query(
      `SELECT e.to_ma_id AS ma_id, n.name, n.genre, n.country, e.score
       FROM graph_edges e
       LEFT JOIN graph_nodes n ON n.ma_id = e.to_ma_id
       WHERE e.from_ma_id = ?
       ORDER BY e.score DESC`
    )
    .all(maId) as GraphEdgeWithNodeRow[]

  return rows.map((r) => ({
    maId: r.ma_id,
    name: r.name ?? "",
    genre: r.genre ?? "",
    country: r.country ?? "",
    score: r.score || 0,
  }))
}

export function getFullGraph(): {
  nodes: { maId: number; name: string; genre: string; country: string }[]
  edges: { from: number; to: number; score: number }[]
} {
  const nodeRows = db.query("SELECT * FROM graph_nodes").all() as GraphNodeRow[]
  const edgeRows = db.query("SELECT * FROM graph_edges").all() as GraphEdgeRow[]

  return {
    nodes: nodeRows.map((r) => ({
      maId: r.ma_id,
      name: r.name,
      genre: r.genre ?? "",
      country: r.country ?? "",
    })),
    edges: edgeRows.map((r) => ({
      from: r.from_ma_id,
      to: r.to_ma_id,
      score: r.score,
    })),
  }
}
