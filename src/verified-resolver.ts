import db, { type MaYoutubeChannelRow, type MaYoutubeTrackRow } from "./db"
import { getDiscographyTracks, normalizeCatalogTitle } from "./ma-client"
import { searchTrackCandidates } from "./yt-client"
import type { MATrack, ResolvedTrack, YTVideo } from "./types"

const VERIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MIN_CHANNEL_EVIDENCE = 2

export interface VerifiedArtistCandidate {
  maId: number
  name: string
  genre: string
  country: string
  source: ResolvedTrack["source"]
  similarTo?: string
  hopsFromAnchor?: number
}

export interface ChannelEvidence {
  track: MATrack
  videos: YTVideo[]
}

export function collectVerifiedChannels(
  evidence: ChannelEvidence[],
  minimum = MIN_CHANNEL_EVIDENCE,
): Map<string, { channelName: string; trackKeys: Set<string>; videoIds: Set<string> }> {
  const channels = new Map<string, { channelName: string; trackKeys: Set<string>; videoIds: Set<string> }>()
  for (const entry of evidence) {
    const trackKey = normalizeCatalogTitle(entry.track.title)
    for (const video of entry.videos) {
      const state = channels.get(video.channelId) ?? {
        channelName: video.channelName,
        trackKeys: new Set<string>(),
        videoIds: new Set<string>(),
      }
      state.trackKeys.add(trackKey)
      state.videoIds.add(video.videoId)
      channels.set(video.channelId, state)
    }
  }
  return new Map([...channels].filter(([, state]) => state.trackKeys.size >= minimum && state.videoIds.size >= minimum))
}

const verificationInFlight = new Map<number, Promise<MaYoutubeChannelRow[]>>()

function loadVerifiedChannels(maId: number): MaYoutubeChannelRow[] {
  const cutoff = Date.now() - VERIFICATION_TTL_MS
  db.run("DELETE FROM ma_youtube_channels WHERE ma_id = ? AND verified_at < ?", [maId, cutoff])
  return db.query("SELECT * FROM ma_youtube_channels WHERE ma_id = ?").all(maId) as MaYoutubeChannelRow[]
}

async function verifyChannels(
  artist: VerifiedArtistCandidate,
  tracks: MATrack[],
  excludeVideoIds: Iterable<string>,
): Promise<MaYoutubeChannelRow[]> {
  const existing = loadVerifiedChannels(artist.maId)
  if (existing.length > 0) return existing
  const active = verificationInFlight.get(artist.maId)
  if (active) return active

  const promise = (async () => {
    const probeTracks = [...tracks]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 4)
    const evidence = await Promise.all(probeTracks.map(async (track) => ({
      track,
      videos: await searchTrackCandidates(artist.name, track.title, {
        excludeVideoIds,
        genreHint: artist.genre,
        expectedTitle: track.title,
        expectedDuration: track.duration,
      }),
    })))
    const verified = collectVerifiedChannels(evidence)
    if (verified.size === 0) return []

    const now = Date.now()
    const insertChannel = db.prepare(
      `INSERT OR REPLACE INTO ma_youtube_channels
       (ma_id, channel_id, channel_name, evidence_count, verified_at) VALUES (?, ?, ?, ?, ?)`,
    )
    const insertTrack = db.prepare(
      `INSERT OR REPLACE INTO ma_youtube_tracks
       (ma_id, title_key, video_id, channel_id, video_title, duration, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const tx = db.transaction(() => {
      for (const [channelId, state] of verified) {
        insertChannel.run(artist.maId, channelId, state.channelName, state.trackKeys.size, now)
        for (const entry of evidence) {
          const key = normalizeCatalogTitle(entry.track.title)
          for (const video of entry.videos.filter((candidate) => candidate.channelId === channelId)) {
            insertTrack.run(artist.maId, key, video.videoId, channelId, video.title, video.duration, now)
          }
        }
      }
    })
    tx()
    return loadVerifiedChannels(artist.maId)
  })().finally(() => verificationInFlight.delete(artist.maId))
  verificationInFlight.set(artist.maId, promise)
  return promise
}

function resolved(artist: VerifiedArtistCandidate, video: YTVideo): ResolvedTrack {
  return {
    maId: artist.maId,
    videoId: video.videoId,
    title: video.title,
    artist: artist.name,
    genre: artist.genre,
    country: artist.country,
    duration: video.duration,
    source: artist.source,
    similarTo: artist.similarTo,
    hopsFromAnchor: artist.hopsFromAnchor,
  }
}

function shuffled<T>(values: T[]): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = result[i]!
    result[i] = result[j]!
    result[j] = current
  }
  return result
}

export async function resolveVerifiedTrack(
  artist: VerifiedArtistCandidate,
  excludeVideoIds: Iterable<string> = [],
): Promise<ResolvedTrack | null> {
  if (!Number.isInteger(artist.maId) || artist.maId <= 0) return null
  const tracks = (await getDiscographyTracks(artist.maId))
    .filter((track) => track.duration >= 60 && track.duration <= 1800)
  if (tracks.length < MIN_CHANNEL_EVIDENCE) {
    console.warn(`Skipping ${artist.name}: fewer than ${MIN_CHANNEL_EVIDENCE} MA discography tracks`)
    return null
  }
  const channels = await verifyChannels(artist, tracks, excludeVideoIds)
  if (channels.length === 0) {
    console.warn(`Skipping ${artist.name}: no YouTube channel verified by two MA tracks`)
    return null
  }
  const allowedChannelIds = new Set(channels.map((channel) => channel.channel_id))
  const excluded = new Set(excludeVideoIds)
  const trackByKey = new Map(tracks.map((track) => [normalizeCatalogTitle(track.title), track]))
  const cutoff = Date.now() - VERIFICATION_TTL_MS
  const cached = (db
    .query("SELECT * FROM ma_youtube_tracks WHERE ma_id = ? AND verified_at >= ?")
    .all(artist.maId, cutoff) as MaYoutubeTrackRow[])
    .filter((row) => allowedChannelIds.has(row.channel_id) && trackByKey.has(row.title_key) && !excluded.has(row.video_id))
  const cachedPick = shuffled(cached)[0]
  if (cachedPick) {
    const channel = channels.find((item) => item.channel_id === cachedPick.channel_id)!
    return resolved(artist, {
      videoId: cachedPick.video_id,
      title: cachedPick.video_title,
      channelId: cachedPick.channel_id,
      channelName: channel.channel_name,
      duration: cachedPick.duration,
    })
  }

  for (const track of shuffled(tracks).slice(0, 4)) {
    const videos = await searchTrackCandidates(artist.name, track.title, {
      excludeVideoIds: excluded,
      genreHint: artist.genre,
      expectedTitle: track.title,
      expectedDuration: track.duration,
      allowedChannelIds,
    })
    const video = videos[0]
    if (!video) continue
    db.run(
      `INSERT OR REPLACE INTO ma_youtube_tracks
       (ma_id, title_key, video_id, channel_id, video_title, duration, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [artist.maId, normalizeCatalogTitle(track.title), video.videoId, video.channelId, video.title, video.duration, Date.now()],
    )
    return resolved(artist, video)
  }
  return null
}
