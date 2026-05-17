import { searchArtist, getSimilarArtists } from "./ma-client"
import { searchTrack } from "./yt-client"
import { getArtist, updateArtist } from "./library"
import { parseGenre } from "./genre"
import type { Artist, ResolvedTrack } from "./types"

export async function resolveTrack(
  artist: Artist,
  trackHint?: string
): Promise<ResolvedTrack | null> {
  if (!artist.maId) {
    const result = await searchArtist(artist.name)
    if (result) {
      updateArtist(artist.name, {
        maId: result.maId,
        genres: parseGenre(result.genre),
        country: result.country,
      })
      artist = getArtist(artist.name) ?? artist
    }
  }

  if (artist.maId) {
    void getSimilarArtists(artist.maId).catch(() => {})
  }

  const ytVideo = await searchTrack(artist.name, trackHint)
  if (!ytVideo) {
    console.warn(`No YouTube result for "${artist.name}"`)
    return null
  }

  return {
    videoId: ytVideo.videoId,
    title: ytVideo.title,
    artist: artist.name,
    genre: artist.genres.length > 0 ? artist.genres.join(" / ") : "Unknown",
    country: artist.country || "",
    duration: ytVideo.duration,
    source: artist.source,
  }
}
