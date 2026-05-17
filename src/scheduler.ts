import { getAllArtists, getArtist, updateArtist } from "./library"
import { searchArtist, runAdapter } from "./ma-client"
import { resolveTrack } from "./resolver"
import { expandArtist, getArtistsInGenre, getGraphNode, getSimilarWithScores, getNeighborhood, getNodesByIds } from "./graph"
import { getMusicMapSimilar } from "./musicmap-client"
import { enqueue, getQueueSize, isRecentArtist, trimRecentArtists, addToHistory, isDuplicate, clearQueue } from "./queue"
import { searchTrack } from "./yt-client"
import { parseGenre, matchesGenre, matchesDecade } from "./genre"
import { getMultiplier, isBlocked } from "./feedback"
import type { Artist, ResolvedTrack, Mode, Spread, Decade, Anchor } from "./types"
import { spreadToHops, ALL_DECADES } from "./types"
import db, { type SettingsRow } from "./db"
import config from "./radio.config"

function loadSetting(key: string): string | null {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as SettingsRow | undefined
  return row?.value ?? null
}

function saveSetting(key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value])
}

const STORED_MODE = loadSetting("mode")
const STORED_ANCHOR = loadSetting("anchor")
const STORED_SPREAD = loadSetting("spread")
const STORED_GENRE = loadSetting("genre")
const STORED_DECADES = loadSetting("decades")

let mode: Mode = STORED_MODE === "band" || STORED_MODE === "genre" ? STORED_MODE : "genre"
let anchor: Anchor | null = (() => {
  if (!STORED_ANCHOR) return null
  try {
    const parsed = JSON.parse(STORED_ANCHOR) as Anchor
    if ((parsed.source === "ma" || parsed.source === "musicmap") && parsed.sourceId && parsed.name) {
      return parsed
    }
  } catch {}
  return null
})()
let spread: Spread = STORED_SPREAD === "narrow" || STORED_SPREAD === "wide" ? STORED_SPREAD : "medium"
let currentGenre: string = STORED_GENRE || config.defaultGenre
let currentDecades: Decade[] = (() => {
  if (!STORED_DECADES) return []
  try {
    const parsed = JSON.parse(STORED_DECADES) as string[]
    return parsed.filter((d): d is Decade => (ALL_DECADES as string[]).includes(d))
  } catch {
    return []
  }
})()
let currentTrack: ResolvedTrack | null = null
let isPlaying = false
let playbackStartedAt = 0
let pausedAt = 0

let genresPromise: Promise<string[]> | null = null
let cachedGenres: string[] | null = null

export function getCurrentGenre(): string {
  return currentGenre
}

export function setGenre(next: string): void {
  if (currentGenre === next) return
  currentGenre = next
  saveSetting("genre", next)
  console.log(`Genre set to: ${next}`)
  clearQueue()
}

export function getMode(): Mode {
  return mode
}

export function setMode(next: Mode): void {
  if (mode === next) return
  mode = next
  saveSetting("mode", next)
  console.log(`Mode set to: ${next}`)
  clearQueue()
}

export function getAnchor(): Anchor | null {
  return anchor
}

export function setAnchor(next: Anchor | null): void {
  anchor = next
  if (next) saveSetting("anchor", JSON.stringify(next))
  else db.run("DELETE FROM settings WHERE key = ?", ["anchor"])
  console.log(`Anchor set to: ${next?.name ?? "(none)"}`)
  clearQueue()
}

export function getSpread(): Spread {
  return spread
}

export function setSpread(next: Spread): void {
  if (spread === next) return
  spread = next
  saveSetting("spread", next)
  console.log(`Spread set to: ${next}`)
  clearQueue()
}

export function getDecades(): Decade[] {
  return [...currentDecades]
}

export function setDecades(next: Decade[]): void {
  currentDecades = [...next]
  saveSetting("decades", JSON.stringify(currentDecades))
  console.log(`Decades set to: ${next.length === 0 ? "(all)" : next.join(", ")}`)
  clearQueue()
}

export function getRadioState() {
  return {
    mode,
    anchor,
    spread,
    genre: currentGenre,
    decades: getDecades(),
    playing: isPlaying,
  }
}

export function getCurrentTrack(): (ResolvedTrack & { progress: number }) | null {
  if (!currentTrack) return null
  const reference = isPlaying ? Date.now() : pausedAt || playbackStartedAt
  const progress = Math.max(0, Math.floor((reference - playbackStartedAt) / 1000))
  return { ...currentTrack, progress }
}

export function getIsPlaying(): boolean {
  return isPlaying
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined
  return arr[Math.floor(Math.random() * arr.length)]
}

function weightedPick<T extends { score: number }>(items: T[]): T | null {
  if (items.length === 0) return null
  const total = items.reduce((sum, i) => sum + Math.max(0, i.score), 0)
  if (total <= 0) return pickRandom(items) ?? null
  let r = Math.random() * total
  for (const item of items) {
    r -= Math.max(0, item.score)
    if (r <= 0) return item
  }
  return items[items.length - 1] ?? null
}

async function findLibraryArtist(genre: string): Promise<Artist | null> {
  const candidates: Artist[] = []
  const fallback: Artist[] = []

  for (const artist of getAllArtists()) {
    if (isRecentArtist(artist.name, config.repeatProtection)) continue
    if (isBlocked(artist.name)) continue

    if (artist.maId && artist.genres.length > 0) {
      if (matchesGenre(artist.genres, genre)) {
        candidates.push(artist)
      }
      continue
    }

    try {
      const ma = await searchArtist(artist.name)
      if (ma && matchesGenre(ma.genre, genre)) {
        updateArtist(artist.name, {
          maId: ma.maId,
          genres: parseGenre(ma.genre),
          country: ma.country,
        })
        const updated = getArtist(artist.name)
        if (updated) candidates.push(updated)
      } else {
        fallback.push(artist)
      }
    } catch {
      fallback.push(artist)
    }
  }

  return pickRandom(candidates) ?? pickRandom(fallback) ?? null
}

async function findSimilarTrack(genre: string): Promise<ResolvedTrack | null> {
  const seedIds = getArtistsInGenre(genre)
  if (seedIds.length === 0) return null

  const seedId = pickRandom(seedIds)
  if (seedId === undefined) return null

  let similar = getSimilarWithScores(seedId)
  if (similar.length === 0) {
    await expandArtist(seedId)
    similar = getSimilarWithScores(seedId)
    if (similar.length === 0) return null
  }

  const allowed = similar.filter((s) => !isBlocked(s.name))
  if (allowed.length === 0) return null

  const genreFiltered = allowed.filter((s) => matchesGenre(s.genre, genre))
  const pool = genreFiltered.length > 0 ? genreFiltered : allowed

  const nonRecent = pool.filter((s) => !isRecentArtist(s.name, config.repeatProtection))
  const finalPool = nonRecent.length > 0 ? nonRecent : pool

  const weighted = finalPool.map((s) => ({
    ...s,
    score: Math.max(0.01, s.score * getMultiplier(s.name)),
  }))
  const chosen = weightedPick(weighted)
  if (!chosen) return null

  const chosenNode = getGraphNode(chosen.maId)
  if (!chosenNode) return null

  void expandArtist(chosen.maId).catch(() => {})

  const ytVideo = await searchTrack(chosenNode.name)
  if (!ytVideo) return null

  const sourceNode = getGraphNode(seedId)

  return {
    videoId: ytVideo.videoId,
    title: ytVideo.title,
    artist: chosenNode.name,
    genre: chosenNode.genre || genre,
    country: chosenNode.country,
    duration: ytVideo.duration,
    source: "similar",
    similarTo: sourceNode?.name,
  }
}

function spreadToMusicMapThreshold(s: Spread): number {
  if (s === "narrow") return 80
  if (s === "medium") return 50
  return 10
}

async function findByMusicMapAnchor(currentAnchor: Anchor, currentSpread: Spread): Promise<ResolvedTrack | null> {
  const similar = await getMusicMapSimilar(currentAnchor.name)
  if (similar.length === 0) return null

  const threshold = spreadToMusicMapThreshold(currentSpread)
  const pool = similar
    .filter((s) => s.score >= threshold)
    .filter((s) => !isRecentArtist(s.name, config.repeatProtection))
    .filter((s) => !isBlocked(s.name))
  if (pool.length === 0) return null

  const weighted = pool.map((s) => ({
    name: s.name,
    score: Math.max(0.01, s.score) * getMultiplier(s.name),
  }))

  const chosen = weightedPick(weighted)
  if (!chosen) return null

  const ytVideo = await searchTrack(chosen.name)
  if (!ytVideo) return null

  return {
    videoId: ytVideo.videoId,
    title: ytVideo.title,
    artist: chosen.name,
    genre: "",
    country: "",
    duration: ytVideo.duration,
    source: "similar",
    similarTo: currentAnchor.name,
    hopsFromAnchor: 1,
  }
}

async function findByBandAnchor(currentAnchor: Anchor, currentSpread: Spread): Promise<ResolvedTrack | null> {
  if (currentAnchor.source === "musicmap") {
    return await findByMusicMapAnchor(currentAnchor, currentSpread)
  }
  if (currentAnchor.source !== "ma") return null
  const anchorId = parseInt(currentAnchor.sourceId, 10)
  if (!Number.isFinite(anchorId)) return null

  await expandArtist(anchorId).catch(() => {})

  const maxHops = spreadToHops(currentSpread)
  const neighborhood = getNeighborhood(anchorId, maxHops)
  if (neighborhood.size === 0) return null

  const ids = [...neighborhood.keys()]
  const nodes = getNodesByIds(ids)
  const nodeById = new Map(nodes.map((n) => [n.ma_id, n]))

  const pool = []
  for (const [id, info] of neighborhood) {
    const node = nodeById.get(id)
    if (!node || !node.name) continue
    if (isRecentArtist(node.name, config.repeatProtection)) continue
    if (isBlocked(node.name)) continue
    const baseScore = Math.max(0.01, info.aggregateScore * 100)
    const weighted = baseScore * getMultiplier(node.name)
    pool.push({ id, hops: info.hops, name: node.name, genre: node.genre ?? "", country: node.country ?? "", score: weighted })
  }
  if (pool.length === 0) return null

  const chosen = weightedPick(pool)
  if (!chosen) return null

  void expandArtist(chosen.id).catch(() => {})

  const ytVideo = await searchTrack(chosen.name)
  if (!ytVideo) return null

  return {
    videoId: ytVideo.videoId,
    title: ytVideo.title,
    artist: chosen.name,
    genre: chosen.genre,
    country: chosen.country,
    duration: ytVideo.duration,
    source: "similar",
    similarTo: currentAnchor.name,
    hopsFromAnchor: chosen.hops,
  }
}

async function findByGenreDecade(
  genre: string,
  decades: Decade[],
  spreadLevel: Spread,
): Promise<ResolvedTrack | null> {
  const seedIds = getArtistsInGenre(genre)
  if (seedIds.length === 0) return null

  const pool = new Map<number, { hops: number; aggregateScore: number }>()
  for (const id of seedIds) pool.set(id, { hops: 0, aggregateScore: 1 })

  if (spreadLevel !== "narrow") {
    const hopBudget = spreadLevel === "medium" ? 1 : 2
    for (const seedId of seedIds) {
      const expanded = getNeighborhood(seedId, hopBudget as 1 | 2)
      for (const [id, info] of expanded) {
        const existing = pool.get(id)
        if (!existing || info.aggregateScore > existing.aggregateScore) {
          pool.set(id, info)
        }
      }
    }
  }

  const ids = [...pool.keys()]
  const nodes = getNodesByIds(ids)

  const buildCandidates = (filterDecade: boolean) => {
    const out: Array<{ id: number; name: string; genre: string; country: string; hops: number; score: number }> = []
    for (const node of nodes) {
      if (!node.name) continue
      if (isRecentArtist(node.name, config.repeatProtection)) continue
      if (isBlocked(node.name)) continue
      if (filterDecade && !matchesDecade((node.decade as Decade | null) ?? null, decades)) continue
      const info = pool.get(node.ma_id)!
      const baseScore = info.hops === 0 ? 1 : Math.max(0.01, info.aggregateScore)
      const weighted = baseScore * getMultiplier(node.name) * 100
      out.push({
        id: node.ma_id,
        name: node.name,
        genre: node.genre ?? "",
        country: node.country ?? "",
        hops: info.hops,
        score: weighted,
      })
    }
    return out
  }

  let candidates = buildCandidates(decades.length > 0)
  if (candidates.length === 0 && decades.length > 0) {
    console.warn(`Genre+Decade pool empty; relaxing decade filter (genre=${genre}, decades=${decades.join(",")})`)
    candidates = buildCandidates(false)
  }
  if (candidates.length === 0) return null

  const chosen = weightedPick(candidates)
  if (!chosen) return null

  void expandArtist(chosen.id).catch(() => {})

  const ytVideo = await searchTrack(chosen.name)
  if (!ytVideo) return null

  return {
    videoId: ytVideo.videoId,
    title: ytVideo.title,
    artist: chosen.name,
    genre: chosen.genre || genre,
    country: chosen.country,
    duration: ytVideo.duration,
    source: chosen.hops === 0 ? "library" : "similar",
  }
}

export async function selectNextTrack(): Promise<ResolvedTrack | null> {
  trimRecentArtists(config.repeatProtection)

  if (mode === "band") {
    if (!anchor) {
      console.warn("Band mode requires an anchor — none set")
      return null
    }
    const track = await findByBandAnchor(anchor, spread)
    if (!track) {
      console.warn(`Band mode: no track in ${spreadToHops(spread)}-hop neighborhood of ${anchor.name}`)
    }
    return track
  }

  if (mode === "genre") {
    if (!currentGenre) {
      console.warn("Genre mode requires a genre — none set")
      return null
    }
    const track = await findByGenreDecade(currentGenre, currentDecades, spread)
    if (track) return track

    if (Math.random() < config.similarWeight) {
      const fallbackTrack = await findSimilarTrack(currentGenre)
      if (fallbackTrack) return fallbackTrack
    }
    const artist = await findLibraryArtist(currentGenre)
    if (artist) return await resolveTrack(artist)
    console.warn(`Genre mode: no artists found for genre "${currentGenre}"`)
    return null
  }

  return null
}

export async function prefetchQueue(maxAttempts = 20): Promise<void> {
  let attempts = 0
  while (getQueueSize() < config.prefetchThreshold && attempts < maxAttempts) {
    attempts++
    try {
      const track = await selectNextTrack()
      if (!track) break
      if (isDuplicate(track, config.repeatProtection)) continue
      enqueue(track)
    } catch (err: any) {
      console.warn("Prefetch error:", err.message)
      break
    }
  }
}

export function markPlaying(track: ResolvedTrack, logHistory = true): void {
  currentTrack = track
  isPlaying = true
  playbackStartedAt = Date.now()
  pausedAt = 0
  if (logHistory) addToHistory(track)
}

export function pause(): void {
  if (!isPlaying) return
  pausedAt = Date.now()
  isPlaying = false
}

export function resume(): void {
  if (isPlaying || !currentTrack) return
  if (pausedAt > 0) {
    playbackStartedAt += Date.now() - pausedAt
  }
  pausedAt = 0
  isPlaying = true
}

export function getAvailableGenres(): string[] {
  const set = new Set<string>()
  for (const artist of getAllArtists()) {
    for (const g of artist.genres) set.add(g)
  }
  return [...set].sort()
}

export async function fetchGenresFromMA(): Promise<string[]> {
  if (cachedGenres) return cachedGenres
  if (genresPromise) return genresPromise
  genresPromise = (async () => {
    try {
      const result = await runAdapter("genres", [])
      const genres = (result?.genres?.length ? result.genres : getAvailableGenres()) as string[]
      cachedGenres = genres
      return genres
    } catch (err) {
      console.warn("Failed to fetch genres from MA:", err)
      const fallback = getAvailableGenres()
      cachedGenres = fallback
      return fallback
    } finally {
      genresPromise = null
    }
  })()
  return genresPromise
}
