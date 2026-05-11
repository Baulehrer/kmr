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
  defaultCountry: string
  server: {
    port: number
  }
}
