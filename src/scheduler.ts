import { getAllArtists, getArtist, updateArtist } from "./library"
import { searchArtist, matchesGenre } from "./ma-client"
import { resolveTrack } from "./resolver"
import { expandArtist, getArtistsInGenre, getGraphNode, getSimilarWithScores } from "./graph"
import { enqueue, getQueueSize, isRecentArtist, trimRecentArtists, addToHistory } from "./queue"
import type { Artist, ResolvedTrack } from "./types"
import config from "./radio.config"

let currentGenre: string = config.defaultGenre
let currentCountry: string = config.defaultCountry
let currentTrack: ResolvedTrack | null = null
let isPlaying = false
let playbackStartedAt = 0

export function getCurrentGenre(): string {
  return currentGenre
}

export function setGenre(genre: string): void {
  currentGenre = genre
  console.log(`Genre set to: ${genre}`)
}

export function getCurrentCountry(): string {
  return currentCountry
}

export function setCountry(country: string): void {
  currentCountry = country
  console.log(`Country set to: ${country}`)
}

export function clearCountry(): void {
  currentCountry = ""
  console.log("Country filter cleared")
}

export function getCurrentTrack(): (ResolvedTrack & { progress: number }) | null {
  if (!currentTrack) return null
  const progress = isPlaying ? Math.floor((Date.now() - playbackStartedAt) / 1000) : 0
  return { ...currentTrack, progress }
}

export function getIsPlaying(): boolean {
  return isPlaying
}

function pickRandom<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)]
}

function weightedPick(items: { maId: number; score: number }[]): number {
  const total = items.reduce((sum, i) => sum + i.score, 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= item.score
    if (r <= 0) return item.maId
  }
  return items[items.length - 1]!.maId
}

function matchesCountry(artistCountry: string, targetCountry: string): boolean {
  if (!targetCountry) return true
  return artistCountry.toLowerCase().includes(targetCountry.toLowerCase())
}

async function findLibraryArtist(genre: string, country: string): Promise<Artist | null> {
  const all = getAllArtists()
  const candidates: Artist[] = []
  const nonGenreFallback: Artist[] = []

  for (const artist of all) {
    if (isRecentArtist(artist.name, config.repeatProtection)) continue

    if (artist.maId && artist.genres.length > 0) {
      const genreOk = artist.genres.some(
        (g) => matchesGenre(g, genre) || g.toLowerCase().includes(genre.toLowerCase())
      )
      const countryOk = matchesCountry(artist.country, country)
      if (genreOk && countryOk) {
        candidates.push(artist)
      }
    } else {
      try {
        const ma = await searchArtist(artist.name)
        if (ma && matchesGenre(ma.genre, genre)) {
          updateArtist(artist.name, {
            maId: ma.maId,
            genres: ma.genre
              .split("/")
              .map((g) => g.trim())
              .filter(Boolean),
            country: ma.country,
          })
          const updated = getArtist(artist.name)
          if (updated && matchesCountry(updated.country, country)) {
            candidates.push(updated)
          }
        } else {
          nonGenreFallback.push(artist)
        }
      } catch {
        nonGenreFallback.push(artist)
      }
    }
  }

  if (candidates.length > 0) return pickRandom(candidates) ?? null
  if (nonGenreFallback.length > 0) return pickRandom(nonGenreFallback) ?? null
  return null
}

async function findSimilarTrack(genre: string, country: string): Promise<ResolvedTrack | null> {
  const genreArtistIds = getArtistsInGenre(genre)
  if (genreArtistIds.length === 0) return null

  const pickId = pickRandom(genreArtistIds)
  if (pickId === undefined) return null

  let similar = getSimilarWithScores(pickId)
  if (similar.length === 0) {
    await expandArtist(pickId)
    similar = getSimilarWithScores(pickId)
    if (similar.length === 0) return null
  }

  let pool = similar.filter(
    (s) =>
      matchesGenre(s.genre, genre) &&
      !isRecentArtist(s.name, config.repeatProtection) &&
      matchesCountry(s.name === "" ? "" : s.name, country)
  )

  if (pool.length === 0) {
    pool = similar.filter((s) => matchesGenre(s.genre, genre))
  }

  const nonRecent = pool.filter((s) => !isRecentArtist(s.name, config.repeatProtection))
  const finalPool = nonRecent.length > 0 ? nonRecent : pool
  if (finalPool.length === 0) return null

  if (country) {
    const countryMatches = finalPool.filter((s) => matchesCountry(s.name === "" ? "" : s.name, country))
    if (countryMatches.length > 0) {
      const chosenId = weightedPick(countryMatches.map((s) => ({ maId: s.maId, score: s.score })))
      const chosenNode = getGraphNode(chosenId)
      if (!chosenNode) return null

      void expandArtist(chosenId)

      const ytModule = await import("./yt-client")
      const ytVideo = await ytModule.searchTrack(chosenNode.name)
      if (!ytVideo) return null

      const sourceNode = getGraphNode(pickId)

      return {
        videoId: ytVideo.videoId,
        title: ytVideo.title,
        artist: chosenNode.name,
        genre: chosenNode.genre || genre,
        country: "",
        duration: ytVideo.duration,
        source: "similar",
        similarTo: sourceNode?.name,
      }
    }
  }

  const chosenId = weightedPick(finalPool.map((s) => ({ maId: s.maId, score: s.score })))
  const chosenNode = getGraphNode(chosenId)
  if (!chosenNode) return null

  void expandArtist(chosenId)

  const ytModule = await import("./yt-client")
  const ytVideo = await ytModule.searchTrack(chosenNode.name)
  if (!ytVideo) return null

  const sourceNode = getGraphNode(pickId)

  return {
    videoId: ytVideo.videoId,
    title: ytVideo.title,
    artist: chosenNode.name,
    genre: chosenNode.genre || genre,
    country: "",
    duration: ytVideo.duration,
    source: "similar",
    similarTo: sourceNode?.name,
  }
}

export async function selectNextTrack(): Promise<ResolvedTrack | null> {
  trimRecentArtists(config.repeatProtection)

  const useSimilar = Math.random() < config.similarWeight

  if (useSimilar) {
    const track = await findSimilarTrack(currentGenre, currentCountry)
    if (track) return track
  }

  const artist = await findLibraryArtist(currentGenre, currentCountry)
  if (!artist) {
    console.warn(`No artists found for genre: ${currentGenre}, country: ${currentCountry || "any"}`)
    return null
  }

  return await resolveTrack(artist)
}

export async function prefetchQueue(): Promise<void> {
  while (getQueueSize() < config.prefetchThreshold) {
    try {
      const track = await selectNextTrack()
      if (!track) break
      enqueue(track)
    } catch (err: any) {
      console.warn("Prefetch error:", err.message)
      break
    }
  }
}

export function markPlaying(track: ResolvedTrack): void {
  currentTrack = track
  isPlaying = true
  playbackStartedAt = Date.now()
  addToHistory(track)
}

export function pause(): void {
  isPlaying = false
}

export function resume(): void {
  if (currentTrack) {
    isPlaying = true
  }
}

export function getAvailableGenres(): string[] {
  const genreSet = new Set<string>()
  for (const artist of getAllArtists()) {
    for (const g of artist.genres) {
      genreSet.add(g)
    }
  }
  return [...genreSet].sort()
}

export function getAvailableCountries(): string[] {
  const countrySet = new Set<string>()
  for (const artist of getAllArtists()) {
    if (artist.country) countrySet.add(artist.country)
  }
  return [...countrySet].sort()
}
