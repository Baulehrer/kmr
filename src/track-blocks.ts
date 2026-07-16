import db from "./db"
import type { ResolvedTrack } from "./types"

export function blockTrack(track: ResolvedTrack): void {
  db.run(
    "INSERT OR REPLACE INTO blocked_tracks (video_id, ma_id, artist, title, blocked_at) VALUES (?, ?, ?, ?, ?)",
    [track.videoId, track.maId, track.artist, track.title, Date.now()],
  )
}

export function isTrackBlocked(videoId: string): boolean {
  return !!db.query("SELECT 1 FROM blocked_tracks WHERE video_id = ?").get(videoId)
}

export function getBlockedVideoIds(): string[] {
  return (db.query("SELECT video_id FROM blocked_tracks").all() as { video_id: string }[]).map((row) => row.video_id)
}
