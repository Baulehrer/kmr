import db, { type ArtistFeedbackRow } from "./db"
import { normalizeName } from "./genre"

const MIN_MULTIPLIER = 0.1
const MAX_MULTIPLIER = 3.0
const LIKE_WEIGHT = 0.5
const DISLIKE_WEIGHT = 1.0

const upsert = db.prepare(
  `INSERT INTO artist_feedback (artist_key, artist, likes, dislikes, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(artist_key) DO UPDATE SET
     likes = likes + excluded.likes,
     dislikes = dislikes + excluded.dislikes,
     artist = excluded.artist,
     updated_at = excluded.updated_at`
)

export interface FeedbackEntry {
  artist: string
  likes: number
  dislikes: number
  multiplier: number
}

export function recordLike(artist: string): FeedbackEntry {
  return record(artist, 1, 0)
}

export function recordDislike(artist: string): FeedbackEntry {
  return record(artist, 0, 1)
}

function record(artist: string, likeDelta: number, dislikeDelta: number): FeedbackEntry {
  const key = normalizeName(artist)
  upsert.run(key, artist, likeDelta, dislikeDelta, Date.now())
  return getFeedback(artist)
}

export function getFeedback(artist: string): FeedbackEntry {
  const key = normalizeName(artist)
  const row = db
    .query("SELECT * FROM artist_feedback WHERE artist_key = ?")
    .get(key) as ArtistFeedbackRow | undefined
  const likes = row?.likes ?? 0
  const dislikes = row?.dislikes ?? 0
  return {
    artist: row?.artist ?? artist,
    likes,
    dislikes,
    multiplier: scoreMultiplier(likes, dislikes),
  }
}

export function getMultiplier(artist: string): number {
  const row = db
    .query("SELECT likes, dislikes FROM artist_feedback WHERE artist_key = ?")
    .get(normalizeName(artist)) as Pick<ArtistFeedbackRow, "likes" | "dislikes"> | undefined
  if (!row) return 1
  return scoreMultiplier(row.likes, row.dislikes)
}

export function isBlocked(artist: string): boolean {
  const row = db
    .query("SELECT likes, dislikes FROM artist_feedback WHERE artist_key = ?")
    .get(normalizeName(artist)) as Pick<ArtistFeedbackRow, "likes" | "dislikes"> | undefined
  if (!row) return false
  return row.dislikes - row.likes >= 3
}

function scoreMultiplier(likes: number, dislikes: number): number {
  const net = likes * LIKE_WEIGHT - dislikes * DISLIKE_WEIGHT
  const raw = 1 + net * 0.5
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, raw))
}

export function listFeedback(): FeedbackEntry[] {
  const rows = db
    .query("SELECT * FROM artist_feedback ORDER BY updated_at DESC")
    .all() as ArtistFeedbackRow[]
  return rows.map((r) => ({
    artist: r.artist,
    likes: r.likes,
    dislikes: r.dislikes,
    multiplier: scoreMultiplier(r.likes, r.dislikes),
  }))
}
