import { Innertube } from "youtubei.js"
import type { YTVideo } from "./types"

let yt: Innertube | null = null
let clientPromise: Promise<Innertube> | null = null

const MIN_DURATION = 60
const MAX_DURATION = 1800

const NON_MUSIC_KEYWORDS = [
  "interview", "podcast", "lecture", "ted talk", "tedtalk", "ted-ed",
  "explained", "documentary", "review", "reaction", "react",
  "tutorial", "lesson", "lyrics video reaction", "first time hearing",
  "story of", "history of", "biography", "behind the scenes",
  "speech", "talk", "discussion", "vlog", "stream highlight",
  "guitar lesson", "drum lesson", "cover by", "tribute by",
  "audiobook", "asmr", "sleep", "meditation",
]

const ALBUM_TRAP_KEYWORDS = [" - single", " - album", " - ep"]

export interface SearchTrackOptions {
  excludeVideoIds?: Iterable<string>
}

/**
 * Score a YouTube video for music track suitability.
 * Positive signals increase score, negative signals decrease it.
 * Returns a score. Videos with score < 0 are disqualified.
 * Higher score = better match.
 */
export function scoreVideo(title: string, channelName: string, artist: string): number {
  const lower = `${title} ${channelName}`.toLowerCase()
  const artistLower = artist.toLowerCase()

  // Hard disqualification: non-music content
  if (NON_MUSIC_KEYWORDS.some((kw) => lower.includes(kw))) return -100

  // Start at 0, accumulate signals
  let score = 0

  // Artist name must be present somewhere
  if (artistLower && lower.includes(artistLower)) score += 10
  else return -50 // not about this artist at all

  // Channel signals
  if (lower.includes(" - topic")) score += 30

  // Title signals
  const titleLower = title.toLowerCase()
  if (titleLower.includes("official")) score += 20
  if (titleLower.includes("lyric")) score += 15
  if (titleLower.includes("audio")) score += 10
  if (titleLower.includes("video")) score += 5

  // Album / Single / EP detection — these are usually not individual tracks
  for (const kw of ALBUM_TRAP_KEYWORDS) {
    if (titleLower.includes(kw)) score -= 25
  }

  return score
}

export async function getClient(): Promise<Innertube> {
  if (yt) return yt
  if (!clientPromise) {
    clientPromise = Innertube.create({ generate_session_locally: true })
      .then((c) => {
        yt = c
        console.log("YouTube Innertube session created")
        return c
      })
      .catch((err) => {
        clientPromise = null
        throw err
      })
  }
  return clientPromise
}

export function pickBestVideo(videos: any[], artist: string, options: SearchTrackOptions = {}): YTVideo | null {
  const excluded = new Set(options.excludeVideoIds ?? [])
  const ranked: Array<{ video: YTVideo; score: number }> = []

  for (const video of videos) {
    const videoId = video?.id
    if (!videoId) continue
    if (excluded.has(videoId)) continue
    const duration = parseDuration(video?.duration?.text)
    if (duration < MIN_DURATION || duration > MAX_DURATION) continue
    const title = video?.title?.text || artist
    const channelName = video?.author?.name || ""
    const candidate: YTVideo = { videoId, title, channelName, duration }
    const score = scoreVideo(title, channelName, artist)
    if (score < 0) continue
    ranked.push({ video: candidate, score })
  }

  ranked.sort((a, b) => b.score - a.score)
  return ranked[0]?.video ?? null
}

async function search(query: string, artist: string, options: SearchTrackOptions): Promise<YTVideo | null> {
  const client = await getClient()
  const results = await client.search(query, { type: "video" })
  const videos = results.videos
  if (!videos || videos.length === 0) return null
  return pickBestVideo(videos as any[], artist, options)
}

export async function searchTrack(
  artist: string,
  track?: string,
  options: SearchTrackOptions = {},
): Promise<YTVideo | null> {
  const queries = track
    ? [`${artist} ${track}`, `${artist} ${track} official`]
    : [`${artist} song`, `${artist} official audio`, `${artist} topic`]
  for (const q of queries) {
    try {
      const found = await search(q, artist, options)
      if (found) return found
    } catch (err: any) {
      console.warn(`YT search error for "${q}":`, err?.message || err)
    }
  }
  return null
}

export function parseDuration(text?: string): number {
  if (!text) return 0
  const parts = text.split(":").map(Number)
  if (parts.some(Number.isNaN)) return 0
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  if (parts.length === 1) return parts[0]!
  return 0
}
