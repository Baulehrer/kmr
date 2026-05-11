import { Database } from "bun:sqlite"
import type { QueueItem, ResolvedTrack } from "./types"

const db = new Database("radio_cache.sqlite", { create: true })

db.run(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    title TEXT,
    artist TEXT,
    genre TEXT,
    country TEXT,
    duration INTEGER DEFAULT 0,
    source TEXT,
    similar_to TEXT,
    played_at INTEGER NOT NULL
  )
`)

const queue: QueueItem[] = []
export const recentArtists: string[] = []

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

export function clearQueue(): void {
  queue.length = 0
}

export function addToHistory(track: ResolvedTrack): void {
  db.run(
    "INSERT INTO history (video_id, title, artist, genre, country, duration, source, similar_to, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    ]
  )

  if (!recentArtists.includes(track.artist)) {
    recentArtists.push(track.artist)
  }
}

export function getHistory(limit = 50): ResolvedTrack[] {
  const rows = db
    .query(
      "SELECT * FROM history ORDER BY played_at DESC LIMIT ?"
    )
    .all(limit) as any[]

  return rows.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    artist: r.artist,
    genre: r.genre,
    country: r.country || "",
    duration: r.duration,
    source: r.source as "library" | "similar" | "discovery",
    similarTo: r.similar_to || undefined,
  }))
}

export function isRecentArtist(artist: string, maxRecent: number): boolean {
  const idx = recentArtists.lastIndexOf(artist)
  if (idx === -1) return false
  return recentArtists.length - idx <= maxRecent
}

export function trimRecentArtists(maxSize: number): void {
  while (recentArtists.length > maxSize) {
    recentArtists.shift()
  }
}
