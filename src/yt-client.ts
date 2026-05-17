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

function isLikelyMusic(title: string, channelName: string, artist: string): boolean {
  const lower = `${title} ${channelName}`.toLowerCase()
  if (NON_MUSIC_KEYWORDS.some((kw) => lower.includes(kw))) return false
  const artistLower = artist.toLowerCase()
  if (artistLower && !lower.includes(artistLower)) return false
  return true
}

export async function getClient(): Promise<Innertube> {
  if (yt) return yt
  if (!clientPromise) {
    clientPromise = Innertube.create({ generate_session_locally: true }).then((c) => {
      yt = c
      console.log("YouTube Innertube session created")
      return c
    })
  }
  return clientPromise
}

function pickVideo(videos: any[], artist: string): YTVideo | null {
  let fallback: YTVideo | null = null
  for (const video of videos) {
    const videoId = video?.id
    if (!videoId) continue
    const duration = parseDuration(video?.duration?.text)
    if (duration < MIN_DURATION || duration > MAX_DURATION) continue
    const title = video?.title?.text || artist
    const channelName = video?.author?.name || ""
    const candidate: YTVideo = { videoId, title, channelName, duration }
    if (isLikelyMusic(title, channelName, artist)) return candidate
    if (!fallback) fallback = candidate
  }
  return fallback
}

async function search(query: string, artist: string): Promise<YTVideo | null> {
  const client = await getClient()
  const results = await client.search(query, { type: "video" })
  const videos = results.videos
  if (!videos || videos.length === 0) return null
  return pickVideo(videos as any[], artist)
}

export async function searchTrack(artist: string, track?: string): Promise<YTVideo | null> {
  const queries = track
    ? [`${artist} ${track}`, `${artist} ${track} official`]
    : [`${artist} song`, `${artist} official audio`, `${artist} topic`]
  for (const q of queries) {
    try {
      const found = await search(q, artist)
      if (found && isLikelyMusic(found.title, found.channelName, artist)) return found
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
