import { Innertube } from "youtubei.js"
import type { YTVideo } from "./types"

let yt: Innertube | null = null

export async function getClient(): Promise<Innertube> {
  if (!yt) {
    yt = await Innertube.create({
      generate_session_locally: true,
    })
    console.log("YouTube Innertube session created")
  }
  return yt
}

export async function searchTrack(artist: string, track?: string): Promise<YTVideo | null> {
  const client = await getClient()
  const query = track ? `${artist} - ${track}` : `${artist}`

  try {
    const results = await client.search(query, { type: "video" })
    const videos = results.videos

    if (!videos || videos.length === 0) {
      return await searchFallback(artist)
    }

    for (const video of videos) {
      const videoId = (video as any).id
      const durationText = (video as any).duration?.text
      const titleText = (video as any).title?.text
      const authorName = (video as any).author?.name

      if (!videoId) continue
      const duration = parseDuration(durationText)
      if (duration <= 0 || duration > 3600) continue

      return {
        videoId,
        title: titleText || `${artist}`,
        channelName: authorName || "",
        duration,
      }
    }

    return await searchFallback(artist)
  } catch (err) {
    console.error(`YT search error for "${query}":`, err)
    return null
  }
}

async function searchFallback(artist: string): Promise<YTVideo | null> {
  const client = await getClient()
  try {
    const results = await client.search(`${artist} official`, { type: "video" })
    const videos = results.videos
    if (!videos || videos.length === 0) return null

    for (const video of videos) {
      const videoId = (video as any).id
      const durationText = (video as any).duration?.text
      const titleText = (video as any).title?.text
      const authorName = (video as any).author?.name

      if (!videoId) continue
      const duration = parseDuration(durationText)
      if (duration <= 0 || duration > 3600) continue

      return {
        videoId,
        title: titleText || `${artist}`,
        channelName: authorName || "",
        duration,
      }
    }
  } catch {
    // ignore fallback errors
  }
  return null
}

function parseDuration(text?: string): number {
  if (!text) return 0
  const parts = text.split(":").map(Number)
  if (parts.some(isNaN)) return 0
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  return 0
}
