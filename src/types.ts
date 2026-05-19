export interface Artist {
  name: string
  maId: number | null
  genres: string[]
  country: string
  similarIds: number[]
  source: "library" | "similar" | "discovery"
}

export interface MASearchResult {
  maId: number
  name: string
  genre: string
  country: string
}

export interface MAArtistDetail {
  maId: number
  name: string
  genre: string
  country: string
  location: string
  formedIn: string | null
}

export interface SimilarArtist {
  maId: number
  name: string
  genre: string
  country: string
  score: number
}

export interface YTVideo {
  videoId: string
  title: string
  channelName: string
  duration: number
}

export interface ResolvedTrack {
  videoId: string
  title: string
  artist: string
  genre: string
  country: string
  duration: number
  source: "library" | "similar" | "discovery"
  similarTo?: string
  hopsFromAnchor?: number
}

export interface QueueItem {
  track: ResolvedTrack
  scheduledAt: number
  playedAt: number | null
}

export interface RadioConfig {
  libraryPath: string
  maRateLimit: number
  queueSize: number
  prefetchThreshold: number
  repeatProtection: number
  similarWeight: number
  defaultGenre: string
  server: {
    port: number
  }
}

export type Mode = "band" | "genre"
export type Spread = "narrow" | "medium" | "wide"
export type Decade = "70s" | "80s" | "90s" | "00s" | "10s" | "20s"
export type AnchorSource = "ma" | "musicmap"

export interface Anchor {
  source: AnchorSource
  sourceId: string
  name: string
}

export const ALL_DECADES: Decade[] = ["70s", "80s", "90s", "00s", "10s", "20s"]

export function spreadToHops(spread: Spread): 1 | 2 | 3 {
  if (spread === "narrow") return 1
  if (spread === "medium") return 2
  return 3
}

/** Minimum similarity score (0-100) for music-map results per spread level */
export function spreadToMusicMapThreshold(spread: Spread): number {
  if (spread === "narrow") return 80
  if (spread === "medium") return 50
  return 10
}
