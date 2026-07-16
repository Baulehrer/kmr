import db, { type ArtistFeedbackRow } from "./db"
import { normalizeName } from "./genre"

const MIN_MULTIPLIER = 0.75
const MAX_MULTIPLIER = 1.25
const LIKE_WEIGHT = 0.04
const DISLIKE_WEIGHT = 0.06

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
  maId?: number
  artist: string
  likes: number
  dislikes: number
  multiplier: number
}

function feedbackKey(artist: string, maId?: number | null): string {
  return maId && maId > 0 ? `ma:${maId}` : normalizeName(artist)
}

function findRow(artist: string, maId?: number | null): ArtistFeedbackRow | undefined {
  const exact = db.query("SELECT * FROM artist_feedback WHERE artist_key = ?").get(feedbackKey(artist, maId)) as ArtistFeedbackRow | undefined
  if (exact || !maId) return exact
  const count = db.query("SELECT COUNT(*) AS count FROM ma_artists WHERE name_key = ?").get(normalizeName(artist)) as { count: number }
  if (count.count !== 1) return undefined
  return db.query("SELECT * FROM artist_feedback WHERE artist_key = ?").get(normalizeName(artist)) as ArtistFeedbackRow | undefined
}

export function recordLike(artist: string, maId?: number): FeedbackEntry {
  return record(artist, maId, 1, 0)
}

export function recordDislike(artist: string, maId?: number): FeedbackEntry {
  return record(artist, maId, 0, 1)
}

function record(artist: string, maId: number | undefined, likeDelta: number, dislikeDelta: number): FeedbackEntry {
  const key = feedbackKey(artist, maId)
  upsert.run(key, artist, likeDelta, dislikeDelta, Date.now())
  return getFeedback(artist, maId)
}

export function getFeedback(artist: string, maId?: number): FeedbackEntry {
  const row = findRow(artist, maId)
  const likes = row?.likes ?? 0
  const dislikes = row?.dislikes ?? 0
  return {
    maId,
    artist: row?.artist ?? artist,
    likes,
    dislikes,
    multiplier: scoreMultiplier(likes, dislikes),
  }
}

export function getMultiplier(artist: string, maId?: number): number {
  const row = findRow(artist, maId)
  if (!row) return 1
  return scoreMultiplier(row.likes, row.dislikes)
}

function scoreMultiplier(likes: number, dislikes: number): number {
  const raw = 1 + likes * LIKE_WEIGHT - dislikes * DISLIKE_WEIGHT
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
