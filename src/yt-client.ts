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
  "guitar lesson", "drum lesson", "cover", "tribute",
  "audiobook", "asmr", "sleep", "meditation", "karaoke",
  "backing track", "slowed", "sped up", "nightcore",
  "full album", "album stream", "compilation", "playlist",
]

const ALBUM_TRAP_KEYWORDS = [" - single", " - album", " - ep"]
const CHANNEL_SUFFIXES = ["topic", "official", "vevo"]
const GENRE_QUERY_TERMS = [
  "black metal", "death metal", "doom metal", "heavy metal",
  "power metal", "progressive metal", "prog metal", "thrash metal",
  "speed metal", "folk metal", "viking metal", "pagan metal",
  "symphonic metal", "gothic metal", "industrial metal",
  "groove metal", "metalcore", "deathcore", "grindcore", "hard rock", "rock",
]
const GENRE_KEYWORD_QUERIES: [keyword: string, queryTerm: string][] = [
  ["deathcore", "deathcore"],
  ["metalcore", "metalcore"],
  ["black", "black metal"],
  ["death", "death metal"],
  ["doom", "doom metal"],
  ["stoner", "stoner rock"],
  ["sludge", "sludge metal"],
  ["heavy", "heavy metal"],
  ["power", "power metal"],
  ["progressive", "progressive metal"],
  ["prog", "prog metal"],
  ["thrash", "thrash metal"],
  ["speed", "speed metal"],
  ["folk", "folk metal"],
  ["viking", "viking metal"],
  ["pagan", "pagan metal"],
  ["symphonic", "symphonic metal"],
  ["gothic", "gothic metal"],
  ["industrial", "industrial metal"],
  ["grindcore", "grindcore"],
  ["groove", "groove metal"],
  ["hard rock", "hard rock"],
  ["rock", "rock"],
]

export interface SearchTrackOptions {
  excludeVideoIds?: Iterable<string>
  genreHint?: string
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function containsKeyword(text: string, keyword: string): boolean {
  const normalizedText = normalizeText(text)
  const normalizedKeyword = normalizeText(keyword)
  if (!normalizedText || !normalizedKeyword) return false
  if (normalizedKeyword.includes(" ")) return normalizedText.includes(normalizedKeyword)
  return normalizedText.split(" ").includes(normalizedKeyword)
}

function compact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "")
}

function stripChannelSuffixes(value: string): string {
  const parts = normalizeText(value).split(" ").filter(Boolean)
  while (parts.length > 1 && CHANNEL_SUFFIXES.includes(parts[parts.length - 1]!)) {
    parts.pop()
  }
  return parts.join(" ")
}

function isLikelyArtistChannel(channelName: string, artist: string): boolean {
  const artistNorm = normalizeText(artist)
  const channelNorm = stripChannelSuffixes(channelName)
  if (!artistNorm || !channelNorm) return false
  if (channelNorm === artistNorm) return true

  const artistCompact = compact(artist)
  const channelCompact = compact(channelName)
  return channelCompact === artistCompact
    || channelCompact === `${artistCompact}official`
    || channelCompact === `${artistCompact}topic`
    || channelCompact === `${artistCompact}vevo`
}

function splitTitleCredit(title: string): string | null {
  const match = title.match(/^\s*(.+?)\s*(?:[-–—:|•])\s+.+$/)
  return match?.[1]?.trim() || null
}

function creditMatchesArtist(credit: string, artist: string): boolean {
  const artistNorm = normalizeText(artist)
  const creditNorm = stripChannelSuffixes(credit)
  if (!artistNorm || !creditNorm) return false
  if (creditNorm === artistNorm) return true

  const artistWords = artistNorm.split(" ")
  if (artistWords.length < 2) return false
  return creditNorm.startsWith(`${artistNorm} `)
}

function titleStartsWithArtistCredit(title: string, artist: string): boolean {
  const credit = splitTitleCredit(title)
  if (credit) return creditMatchesArtist(credit, artist)

  const artistNorm = normalizeText(artist)
  const titleNorm = normalizeText(title)
  const artistWords = artistNorm.split(" ").filter(Boolean)
  return artistWords.length >= 2 && titleNorm.startsWith(`${artistNorm} `)
}

function titleHasByArtistCredit(title: string, artist: string): boolean {
  const titleNorm = normalizeText(title)
  const artistNorm = normalizeText(artist)
  if (!titleNorm || !artistNorm) return false
  return titleNorm.includes(` by ${artistNorm}`)
    || titleNorm.endsWith(` by ${artistNorm}`)
}

function hasWrongLeadingCredit(title: string, artist: string): boolean {
  const credit = splitTitleCredit(title)
  return !!credit && !creditMatchesArtist(credit, artist)
}

function genreQueryTerms(genreHint?: string): string[] {
  if (!genreHint) return []
  const normalized = normalizeText(genreHint)
  const out = new Set<string>()
  for (const [keyword, term] of GENRE_KEYWORD_QUERIES) {
    if (containsKeyword(normalized, keyword)) out.add(term)
  }
  for (const term of GENRE_QUERY_TERMS) {
    if (normalized.includes(term)) out.add(term)
  }
  if (normalized.includes("metal")) out.add("metal")
  return [...out].slice(0, 3)
}

/**
 * Score a YouTube video for music track suitability.
 * Positive signals increase score, negative signals decrease it.
 * Returns a score. Videos with score < 0 are disqualified.
 * Higher score = better match.
 */
export function scoreVideo(title: string, channelName: string, artist: string): number {
  const lower = `${title} ${channelName}`.toLowerCase()

  // Hard disqualification: non-music content
  if (NON_MUSIC_KEYWORDS.some((kw) => containsKeyword(lower, kw))) return -100

  const trustedChannel = isLikelyArtistChannel(channelName, artist)
  const trustedTitle = titleStartsWithArtistCredit(title, artist) || titleHasByArtistCredit(title, artist)

  // Reject "song title trap" results such as:
  // artist=Rainbow, title="Kacey Musgraves - Rainbow", channel="KaceyMusgravesVEVO".
  if (!trustedChannel && hasWrongLeadingCredit(title, artist)) return -80

  if (!trustedChannel && !trustedTitle) return -50

  // Start at 0, accumulate signals
  let score = 0

  if (trustedChannel) score += 45
  if (trustedTitle) score += 35

  // Channel signals
  if (lower.includes(" - topic")) score += 30

  // Title signals
  const titleLower = title.toLowerCase()
  if (titleLower.includes("official")) score += 20
  if (titleLower.includes("lyric")) score += 15
  if (titleLower.includes("audio")) score += 10
  if (titleLower.includes("video")) score += 5
  if (titleLower.includes("metal") || titleLower.includes("rock")) score += 5

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
  const genreTerms = genreQueryTerms(options.genreHint)
  const queries = track
    ? [
        `${artist} ${track}`,
        `${artist} ${track} official`,
        ...genreTerms.map((term) => `${artist} ${track} ${term}`),
      ]
    : [
        ...genreTerms.flatMap((term) => [
          `${artist} ${term} official audio`,
          `${artist} ${term} song`,
        ]),
        `${artist} official audio`,
        `${artist} official video`,
        `${artist} topic`,
        `${artist} song`,
      ]
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
