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
  formedIn: string | null
}

export interface MARelease {
  maId: number
  albumId: number
  title: string
  type: string
  year: string
  coverUrl?: string
  releaseDate?: string
  label?: string
  catalogId?: string
  format?: string
  rating?: number
  reviewCount?: number
}

export interface MATrack {
  maId: number
  albumId: number
  album: string
  title: string
  duration: number
  releaseType?: string
  releaseYear?: string
}

export interface MAArtistDetail {
  maId: number
  name: string
  genre: string
  country: string
  location: string
  formedIn: string | null
  status: string
  yearsActive: string
  themes: string
  label: string
  logoUrl: string
  photoUrl: string
  members: MAMember[]
}

export interface MAMember {
  name: string
  role: string
  kind: "current" | "past" | "live"
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
  channelId: string
  duration: number
}

export interface ResolvedTrack {
  maId: number
  videoId: string
  title: string
  videoTitle?: string
  albumId?: number
  album?: string
  artist: string
  genre: string
  country: string
  duration: number
  source: "library" | "similar" | "discovery"
  similarTo?: string
  hopsFromAnchor?: number
  selectionReason?: string
  allowArtistRepeat?: boolean
}

export type ReleaseTypeFilter = "studio" | "ep" | "live" | "demo" | "single" | "other"

export const ALL_RELEASE_TYPES: ReleaseTypeFilter[] = ["studio", "ep", "live", "demo", "single", "other"]

export interface LyricLine {
  startMs: number
  text: string
}

export interface LyricsResult {
  videoId: string
  kind: "synced" | "plain" | "missing"
  source: "LRCLIB"
  lines: LyricLine[]
  text: string
  cachedAt: number
}

export interface ArtistFocus {
  maId: number
  name: string
}

export interface QueueItem {
  track: ResolvedTrack
  scheduledAt: number
  playedAt: number | null
}

export interface RadioConfig {
  libraryPath: string
  maRateLimit: number
  maGraphExpansionBudget: number
  anchorMixWindow: number
  ytResolveCandidates: number
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
export type AnchorSource = "ma"

export interface Anchor {
  source: AnchorSource
  sourceId: string
  name: string
  genre?: string
  country?: string
  formedIn?: string | null
}

export const ALL_DECADES: Decade[] = ["70s", "80s", "90s", "00s", "10s", "20s"]

export interface SpreadConfig {
  minScore: number
  maxHops: 1 | 2 | 3
}

export const SPREAD_CONFIG: Record<Spread, SpreadConfig> = {
  narrow: { minScore: 70, maxHops: 2 },
  medium: { minScore: 40, maxHops: 2 },
  wide: { minScore: 10, maxHops: 3 },
}

export function getSpreadConfig(spread: Spread): SpreadConfig {
  return SPREAD_CONFIG[spread]
}

export function spreadToHops(spread: Spread): 1 | 2 | 3 {
  return SPREAD_CONFIG[spread].maxHops
}
