import { getAllArtists, getArtist, updateArtist } from "./library"
import { searchArtist, runAdapter } from "./ma-client"
import { expandArtist, getArtistsInGenre, getGraphNode, getSimilarWithScores, getNeighborhood, getNodesByIds, hasGraphEdges, upsertGraphNode } from "./graph"
import { enqueue, getQueueSize, getQueuedVideoIds, getRecentVideoIds, isRecentArtist, trimRecentArtists, addToHistory, isDuplicate, clearQueue } from "./queue"
import { parseGenre, matchesGenre, filterCanonical, CANONICAL_GENRES, toCanonicalGenre } from "./genre"
import { getMultiplier, isBlocked } from "./feedback"
import { getBlockedVideoIds } from "./track-blocks"
import { resolveVerifiedTrack } from "./verified-resolver"
import type { Artist, ArtistFocus, ResolvedTrack, Mode, Spread, Decade, Anchor, SpreadConfig, ReleaseTypeFilter } from "./types"
import { spreadToHops, ALL_DECADES, ALL_RELEASE_TYPES, getSpreadConfig } from "./types"
import db, { type MaArtistRow, type SettingsRow } from "./db"
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
const STORED_ANCHOR_FREQUENCY = loadSetting("anchorFrequency")
const STORED_RELEASE_TYPES = loadSetting("releaseTypes")
const STORED_COUNTRY = loadSetting("country")

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function resetBandMix(): void {
  bandPickWindow = []
}

let mode: Mode = STORED_MODE === "band" || STORED_MODE === "genre" ? STORED_MODE : "genre"
let anchor: Anchor | null = (() => {
  if (!STORED_ANCHOR) return null
  try {
    const parsed = JSON.parse(STORED_ANCHOR) as Anchor
    if (parsed.source === "ma" && parsed.sourceId && parsed.name) {
      return parsed
    }
  } catch {}
  return null
})()
if (STORED_ANCHOR && !anchor) db.run("DELETE FROM settings WHERE key = ?", ["anchor"])
let spread: Spread = STORED_SPREAD === "narrow" || STORED_SPREAD === "wide" ? STORED_SPREAD : "medium"
let currentGenre: string = toCanonicalGenre(STORED_GENRE || "") ?? config.defaultGenre
let currentDecades: Decade[] = (() => {
  if (!STORED_DECADES) return []
  try {
    const parsed = JSON.parse(STORED_DECADES) as string[]
    return parsed.filter((d): d is Decade => (ALL_DECADES as string[]).includes(d))
  } catch {
    return []
  }
})()
let currentReleaseTypes: ReleaseTypeFilter[] = (() => {
  if (!STORED_RELEASE_TYPES) return [...ALL_RELEASE_TYPES]
  try {
    const parsed = JSON.parse(STORED_RELEASE_TYPES) as string[]
    const valid = parsed.filter((type): type is ReleaseTypeFilter => (ALL_RELEASE_TYPES as string[]).includes(type))
    return valid.length > 0 ? valid : [...ALL_RELEASE_TYPES]
  } catch { return [...ALL_RELEASE_TYPES] }
})()
let currentCountry = STORED_COUNTRY || ""
let currentTrack: ResolvedTrack | null = null
let artistFocus: ArtistFocus | null = null
let focusArtist: { maId: number; name: string; genre: string; country: string; source: ResolvedTrack["source"] } | null = null
const focusSeenVideoIds = new Set<string>()
let isPlaying = false
let playbackStartedAt = 0
let pausedAt = 0

let genresPromise: Promise<string[]> | null = null
let cachedGenres: string[] | null = null
const parsedAnchorFrequency = Number.parseInt(STORED_ANCHOR_FREQUENCY || "0", 10)
let anchorFrequency: number = Number.isFinite(parsedAnchorFrequency) ? clampPercent(parsedAnchorFrequency) : 0
const FIND_LIBRARY_LOOKUP_LIMIT = 50
let prefetchInFlight: Promise<void> | null = null
type BandPick = "anchor" | "similar"
let bandPickWindow: BandPick[] = []
const hydratedAnchorNeighborhoods = new Set<string>()
const anchorHydrationRetryAt = new Map<string, number>()

export function getCurrentGenre(): string {
  return currentGenre
}

export function setGenre(next: string): void {
  const canonical = toCanonicalGenre(next) ?? next
  if (currentGenre === canonical) return
  currentGenre = canonical
  saveSetting("genre", canonical)
  console.log(`Genre set to: ${canonical}`)
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
  resetBandMix()
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
  resetBandMix()
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
  resetBandMix()
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

export function getReleaseTypes(): ReleaseTypeFilter[] {
  return [...currentReleaseTypes]
}

export function setReleaseTypes(next: ReleaseTypeFilter[]): void {
  currentReleaseTypes = [...next]
  saveSetting("releaseTypes", JSON.stringify(currentReleaseTypes))
  console.log(`Release types set to: ${currentReleaseTypes.join(", ")}`)
  clearQueue()
}

export function getCountry(): string {
  return currentCountry
}

export function setCountry(next: string): void {
  currentCountry = next.trim()
  saveSetting("country", currentCountry)
  console.log(`Country set to: ${currentCountry || "(all)"}`)
  clearQueue()
}

export function getTopCountries(limit = 20): string[] {
  return (db.query(
    `SELECT country, COUNT(*) AS count FROM ma_artists
     WHERE country IS NOT NULL AND TRIM(country) != ''
     GROUP BY country ORDER BY count DESC, country LIMIT ?`,
  ).all(limit) as { country: string }[]).map((row) => row.country)
}

export function getRadioState() {
  return {
    mode,
    anchor,
    spread,
    genre: currentGenre,
    decades: getDecades(),
    playing: isPlaying,
    anchorFrequency,
    artistFocus,
    releaseTypes: getReleaseTypes(),
    country: getCountry(),
  }
}

export function getArtistFocus(): ArtistFocus | null {
  return artistFocus ? { ...artistFocus } : null
}

export function startArtistFocus(maId: number, videoId: string): ArtistFocus | null {
  if (!currentTrack || currentTrack.maId !== maId || currentTrack.videoId !== videoId) return null
  artistFocus = { maId, name: currentTrack.artist }
  focusArtist = {
    maId,
    name: currentTrack.artist,
    genre: currentTrack.genre,
    country: currentTrack.country,
    source: currentTrack.source,
  }
  focusSeenVideoIds.clear()
  focusSeenVideoIds.add(currentTrack.videoId)
  clearQueue()
  return getArtistFocus()
}

export function stopArtistFocus(): void {
  artistFocus = null
  focusArtist = null
  focusSeenVideoIds.clear()
  clearQueue()
}

export function getCurrentTrack(): (ResolvedTrack & { progress: number }) | null {
  if (!currentTrack) return null
  const reference = isPlaying ? Date.now() : pausedAt > 0 ? pausedAt : playbackStartedAt
  const progress = Math.max(0, Math.floor((reference - playbackStartedAt) / 1000))
  return { ...currentTrack, progress }
}

export function getIsPlaying(): boolean {
  return isPlaying
}

export function getAnchorFrequency(): number {
  return anchorFrequency
}

export function setAnchorFrequency(next: number): void {
  const clamped = clampPercent(next)
  if (anchorFrequency === clamped) return
  anchorFrequency = clamped
  saveSetting("anchorFrequency", String(clamped))
  console.log(`Anchor frequency set to: ${clamped}%`)
  resetBandMix()
  clearQueue()
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

function weightedSample<T extends { score: number }>(items: T[], count: number): T[] {
  const pool = [...items]
  const out: T[] = []
  while (pool.length > 0 && out.length < count) {
    const picked = weightedPick(pool)
    if (!picked) break
    out.push(picked)
    pool.splice(pool.indexOf(picked), 1)
  }
  return out
}

export function chooseBandSource(anchorPercent: number, recent: BandPick[], windowSize = config.anchorMixWindow): BandPick {
  const percent = clampPercent(anchorPercent)
  if (percent <= 0) return "similar"
  if (percent >= 100) return "anchor"

  const usableWindowSize = Math.max(2, windowSize)
  const window = recent.slice(-(usableWindowSize - 1))
  const nextSize = window.length + 1
  const targetAnchors = Math.ceil((percent / 100) * nextSize)
  const anchorCount = window.filter((pick) => pick === "anchor").length
  return anchorCount < targetAnchors ? "anchor" : "similar"
}

function trackBandPick(track: ResolvedTrack): void {
  if (mode !== "band" || !anchor) return
  const pick: BandPick = track.hopsFromAnchor === 0 ? "anchor" : "similar"
  bandPickWindow.push(pick)
  const max = Math.max(2, config.anchorMixWindow)
  while (bandPickWindow.length > max) bandPickWindow.shift()
}

function getAvoidVideoIds(): Set<string> {
  const ids = new Set<string>(getQueuedVideoIds())
  for (const id of getBlockedVideoIds()) ids.add(id)
  const historyLimit = Math.max(config.repeatProtection * 3, config.queueSize * 3, 25)
  for (const id of getRecentVideoIds(historyLimit)) ids.add(id)
  if (currentTrack) ids.add(currentTrack.videoId)
  return ids
}

function isAnchorTrack(track: ResolvedTrack): boolean {
  return mode === "band"
    && !!anchor
    && track.hopsFromAnchor === 0
    && track.maId === Number.parseInt(anchor.sourceId, 10)
}

function isDuplicateForPlayback(track: ResolvedTrack): boolean {
  if (artistFocus) {
    if (track.maId !== artistFocus.maId) return true
    return track.videoId === currentTrack?.videoId || getQueuedVideoIds().includes(track.videoId)
  }
  if (track.allowArtistRepeat) return getAvoidVideoIds().has(track.videoId)
  if (!isAnchorTrack(track)) return isDuplicate(track, config.repeatProtection)
  return getAvoidVideoIds().has(track.videoId)
}

async function findArtistFocusTrack(): Promise<ResolvedTrack | null> {
  if (!artistFocus || !focusArtist) return null
  const candidate = { ...focusArtist, releaseTypes: currentReleaseTypes, decades: currentDecades, selectionReason: `Band-Fokus auf ${focusArtist.name} ist aktiv.` }
  let track = await resolveVerifiedTrack(candidate, focusSeenVideoIds)
  if (!track && getQueueSize() === 0) {
    focusSeenVideoIds.clear()
    if (currentTrack) focusSeenVideoIds.add(currentTrack.videoId)
    track = await resolveVerifiedTrack(candidate, focusSeenVideoIds)
  }
  if (track) focusSeenVideoIds.add(track.videoId)
  return track
}

interface FallbackCandidate {
  name: string
}

/**
 * Try resolving up to `count` candidates from the weighted-sorted pool via YouTube.
 * Fires the YT searches in parallel and returns the first successful result in
 * candidate order.
 * Returns the first successful ResolvedTrack, or null if all fail.
 */
async function tryResolveWithFallback<T extends FallbackCandidate>(
  candidates: T[],
  resolve: (candidate: T) => Promise<ResolvedTrack | null>,
  count = 3,
): Promise<ResolvedTrack | null> {
  if (candidates.length === 0) return null
  const limit = Math.min(count, candidates.length)
  const promises = candidates.slice(0, limit).map((candidate) => resolve(candidate))
  const results = await Promise.allSettled(promises)
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) return r.value
  }
  return null
}

async function findLibraryArtist(genre: string, country = ""): Promise<Artist | null> {
  const candidates: Artist[] = []
  let lookups = 0

  for (const artist of getAllArtists()) {
    if (isRecentArtist(artist.name, config.repeatProtection, artist.maId)) continue
    if (isBlocked(artist.name, artist.maId ?? undefined)) continue
    if (country && artist.country && artist.country !== country) continue

    if (artist.maId && artist.genres.length > 0) {
      if (matchesGenre(artist.genres, genre)) {
        candidates.push(artist)
      }
      continue
    }

    if (lookups >= FIND_LIBRARY_LOOKUP_LIMIT) continue
    lookups++

    try {
      const ma = await searchArtist(artist.name)
      if (ma && matchesGenre(ma.genre, genre) && (!country || ma.country === country)) {
        const genres = filterCanonical(parseGenre(ma.genre))
        updateArtist(artist.name, {
          maId: ma.maId,
          genres,
          country: ma.country,
        })
        upsertGraphNode({ maId: ma.maId, name: ma.name, genre: ma.genre, country: ma.country })
        const updated = getArtist(artist.name)
        if (updated) candidates.push(updated)
      }
    } catch (err) {
      console.warn("findLibraryArtist error for", artist.name, err)
    }
  }

  return pickRandom(candidates) ?? null
}

async function findSimilarTrack(genre: string, country = ""): Promise<ResolvedTrack | null> {
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

  const allowed = similar.filter((s) => !isBlocked(s.name, s.maId))
  if (allowed.length === 0) return null

  const pool = allowed.filter((s) => matchesGenre(s.genre, genre) && (!country || s.country === country))
  if (pool.length === 0) return null

  const nonRecent = pool.filter((s) => !isRecentArtist(s.name, config.repeatProtection, s.maId))
  const finalPool = nonRecent.length > 0 ? nonRecent : pool

  const weighted = finalPool
    .map((s) => ({
      name: s.name,
      maId: s.maId,
      genre: s.genre,
      country: s.country,
      score: Math.max(0.01, s.score * getMultiplier(s.name, s.maId)),
    }))
    .sort((a, b) => b.score - a.score)

  if (weighted.length === 0) return null

  const sourceNode = getGraphNode(seedId)

  const candidates = weightedSample(weighted, Math.max(1, config.ytResolveCandidates))
  const excludeVideoIds = getAvoidVideoIds()

  return await tryResolveWithFallback(candidates, async (candidate) => {
    return await resolveVerifiedTrack({
      maId: candidate.maId,
      name: candidate.name,
      genre: candidate.genre || genre,
      country: candidate.country || "",
      source: "similar",
      similarTo: sourceNode?.name,
      releaseTypes: currentReleaseTypes,
      decades: currentDecades,
      selectionReason: `Passt zum Genre ${genre} und wurde über ${sourceNode?.name || "eine verwandte Band"} gefunden.`,
    }, excludeVideoIds)
  })
}

/** Try to find a YouTube track for the anchor artist itself. */
async function resolveAnchorTrack(currentAnchor: Anchor): Promise<ResolvedTrack | null> {
  const maId = Number.parseInt(currentAnchor.sourceId, 10)
  if (!Number.isInteger(maId)) return null
  const node = getGraphNode(maId)
  return await resolveVerifiedTrack({
    maId,
    name: currentAnchor.name,
    genre: node?.genre || currentAnchor.genre || "",
    country: node?.country || currentAnchor.country || "",
    source: "similar",
    hopsFromAnchor: 0,
    releaseTypes: currentReleaseTypes,
    decades: currentDecades,
    selectionReason: `${currentAnchor.name} ist dein gewählter Artist.`,
  }, getAvoidVideoIds())
}

async function hydrateMaAnchorNeighborhood(anchorId: number, currentSpread: Spread, cfg: SpreadConfig): Promise<void> {
  const key = `${anchorId}:${currentSpread}:${cfg.minScore}:${cfg.maxHops}`
  if (hydratedAnchorNeighborhoods.has(key)) return

  const retryAt = anchorHydrationRetryAt.get(key) ?? 0
  if (retryAt > Date.now()) return

  try {
    await expandArtist(anchorId)

    const budget = Math.max(0, config.maGraphExpansionBudget)
    if (cfg.maxHops > 1 && budget > 0) {
      const direct = [...getNeighborhood(anchorId, 1, cfg.minScore).entries()]
        .sort((a, b) => b[1].aggregateScore - a[1].aggregateScore)
        .map(([id]) => id)
        .filter((id) => !hasGraphEdges(id))
        .slice(0, budget)

      for (const id of direct) {
        try {
          await expandArtist(id)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.warn(`MA graph expansion skipped for ${id}: ${message}`)
        }
      }
    }

    hydratedAnchorNeighborhoods.add(key)
  } catch (err) {
    anchorHydrationRetryAt.set(key, Date.now() + 5 * 60 * 1000)
    throw err
  }
}

async function findSimilarByMaAnchor(currentAnchor: Anchor, currentSpread: Spread): Promise<ResolvedTrack | null> {
  if (currentAnchor.source !== "ma") return null
  const anchorId = parseInt(currentAnchor.sourceId, 10)
  if (!Number.isFinite(anchorId)) return null

  const cfg = getSpreadConfig(currentSpread)
  await hydrateMaAnchorNeighborhood(anchorId, currentSpread, cfg).catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`MA graph hydration failed for ${currentAnchor.name}: ${message}`)
  })

  const neighborhood = getNeighborhood(anchorId, cfg.maxHops, cfg.minScore)
  if (neighborhood.size === 0) return null

  const ids = [...neighborhood.keys()]
  const nodes = getNodesByIds(ids)
  const nodeById = new Map(nodes.map((n) => [n.ma_id, n]))

  const pool = []
  for (const [id, info] of neighborhood) {
    const node = nodeById.get(id)
    if (!node || !node.name) continue
    if (isRecentArtist(node.name, config.repeatProtection, id)) continue
    if (isBlocked(node.name, id)) continue
    const baseScore = Math.max(0.01, info.aggregateScore * 100)
    const weighted = baseScore * getMultiplier(node.name, id)
    pool.push({ id, hops: info.hops, name: node.name, genre: node.genre ?? "", country: node.country ?? "", score: weighted })
  }
  if (pool.length === 0) return null

  const sorted = pool.sort((a, b) => b.score - a.score)
  const candidates = weightedSample(sorted, Math.max(1, config.ytResolveCandidates))
  const excludeVideoIds = getAvoidVideoIds()

  return await tryResolveWithFallback(candidates, async (candidate) => {
    return await resolveVerifiedTrack({
      maId: candidate.id,
      name: candidate.name,
      genre: candidate.genre,
      country: candidate.country,
      source: "similar",
      similarTo: currentAnchor.name,
      hopsFromAnchor: candidate.hops,
      releaseTypes: currentReleaseTypes,
      decades: currentDecades,
      selectionReason: `${candidate.name} ist über ${candidate.hops} Verbindung${candidate.hops === 1 ? "" : "en"} mit ${currentAnchor.name} verwandt.`,
    }, excludeVideoIds)
  })
}

async function findByBandAnchor(currentAnchor: Anchor, currentSpread: Spread): Promise<ResolvedTrack | null> {
  const preferred = chooseBandSource(anchorFrequency, bandPickWindow, config.anchorMixWindow)
  const anchorMaId = Number.parseInt(currentAnchor.sourceId, 10)
  const allowAnchor = anchorFrequency > 0 && !isBlocked(currentAnchor.name, anchorMaId)
  const allowSimilar = anchorFrequency < 100
  const tryAnchor = async () => (allowAnchor ? await resolveAnchorTrack(currentAnchor) : null)
  const trySimilar = async () => {
    if (!allowSimilar) return null
    return await findSimilarByMaAnchor(currentAnchor, currentSpread)
  }

  if (preferred === "anchor") {
    return (await tryAnchor()) ?? (await trySimilar())
  }

  return (await trySimilar()) ?? (await tryAnchor())
}

async function findByGenreDecade(
  genre: string,
  decades: Decade[],
  spreadLevel: Spread,
  country = "",
): Promise<ResolvedTrack | null> {
  const seedIds = getArtistsInGenre(genre)
  if (seedIds.length === 0) return null

  const cfg = getSpreadConfig(spreadLevel)
  const pool = new Map<number, { hops: number; aggregateScore: number }>()
  for (const id of seedIds) pool.set(id, { hops: 0, aggregateScore: 1 })

  if (spreadLevel !== "narrow" || cfg.minScore > 0) {
    const hopBudget = cfg.maxHops
    for (const seedId of seedIds) {
      const expanded = getNeighborhood(seedId, hopBudget, cfg.minScore)
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

  const buildCandidates = (allowRecent = false) => {
    const out: Array<{ id: number; name: string; genre: string; country: string; hops: number; score: number }> = []
    for (const node of nodes) {
      if (!node.name) continue
      if (!allowRecent && isRecentArtist(node.name, config.repeatProtection, node.ma_id)) continue
      if (isBlocked(node.name, node.ma_id)) continue
      if (!matchesGenre(node.genre ?? "", genre)) continue
      if (country && node.country !== country) continue
      const info = pool.get(node.ma_id)!
      const baseScore = info.hops === 0 ? 1 : Math.max(0.01, info.aggregateScore)
      const weighted = baseScore * getMultiplier(node.name, node.ma_id) * 100
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

  let candidates = buildCandidates()
  let relaxedRepeat = false
  if (candidates.length === 0) {
    candidates = buildCandidates(true)
    relaxedRepeat = candidates.length > 0
  }
  if (candidates.length === 0) return null

  const sorted = candidates.sort((a, b) => b.score - a.score)
  const sampled = weightedSample(sorted, Math.max(1, config.ytResolveCandidates))
  const excludeVideoIds = getAvoidVideoIds()

  return await tryResolveWithFallback(sampled, async (candidate) => {
    return await resolveVerifiedTrack({
      maId: candidate.id,
      name: candidate.name,
      genre: candidate.genre || genre,
      country: candidate.country,
      source: candidate.hops === 0 ? "library" : "similar",
      releaseTypes: currentReleaseTypes,
      decades,
      allowArtistRepeat: relaxedRepeat,
      selectionReason: relaxedRepeat
          ? `Passt zu ${genre}; der Artist-Schutz wurde gelockert, damit das Radio weiterläuft.`
          : `Passt zu ${genre}${country ? ` aus ${country}` : ""}${decades.length ? ` und ${decades.join(", ")}` : ""}.`,
    }, excludeVideoIds)
  })
}

async function findKnownMaTrack(genre: string, decades: Decade[], country = ""): Promise<ResolvedTrack | null> {
  const rows = db.query(
    "SELECT * FROM ma_artists WHERE name != '' AND genre IS NOT NULL AND genre != '' ORDER BY updated_at DESC LIMIT 800",
  ).all() as MaArtistRow[]
  const build = (allowRecent: boolean) => rows.filter((row) => {
    if (!matchesGenre(row.genre || "", genre) || isBlocked(row.name, row.ma_id)) return false
    if (country && row.country !== country) return false
    if (!allowRecent && isRecentArtist(row.name, config.repeatProtection, row.ma_id)) return false
    return true
  })
  let candidates = build(false)
  let relaxedRepeat = false
  if (candidates.length === 0) {
    candidates = build(true)
    relaxedRepeat = candidates.length > 0
  }
  const sampled = [...candidates].sort(() => Math.random() - 0.5).slice(0, Math.max(4, config.ytResolveCandidates))
  return await tryResolveWithFallback(sampled, async (candidate) => resolveVerifiedTrack({
    maId: candidate.ma_id,
    name: candidate.name,
    genre: candidate.genre || genre,
    country: candidate.country || "",
    source: "discovery",
    releaseTypes: currentReleaseTypes,
    decades,
    allowArtistRepeat: relaxedRepeat,
    selectionReason: relaxedRepeat
        ? `Passt zu ${genre}; der Artist-Schutz wurde gelockert, damit das Radio weiterläuft.`
        : `Passt zu ${genre}${country ? ` aus ${country}` : ""}${decades.length ? ` und ${decades.join(", ")}` : ""}.`,
  }, getAvoidVideoIds()), sampled.length)
}

export async function selectNextTrack(): Promise<ResolvedTrack | null> {
  trimRecentArtists(config.repeatProtection)

  if (artistFocus) return await findArtistFocusTrack()

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
    const track = await findByGenreDecade(currentGenre, currentDecades, spread, currentCountry)
    if (track) return track

    const knownTrack = await findKnownMaTrack(currentGenre, currentDecades, currentCountry)
    if (knownTrack) return knownTrack

    if (Math.random() < config.similarWeight) {
      const fallbackTrack = await findSimilarTrack(currentGenre, currentCountry)
      if (fallbackTrack) return fallbackTrack
    }
    const artist = await findLibraryArtist(currentGenre, currentCountry)
    if (artist?.maId) {
      return await resolveVerifiedTrack({
        maId: artist.maId,
        name: artist.name,
        genre: artist.genres.join(" / ") || currentGenre,
        country: artist.country,
        source: artist.source,
        releaseTypes: currentReleaseTypes,
        decades: currentDecades,
        selectionReason: `Kommt aus deiner Bibliothek und passt zu ${currentGenre}${currentCountry ? ` aus ${currentCountry}` : ""}.`,
      }, getAvoidVideoIds())
    }
    console.warn(`Genre mode: no artists found for genre "${currentGenre}"`)
    return null
  }

  return null
}

export async function selectPlayableTrack(maxAttempts = 10): Promise<ResolvedTrack | null> {
  let attempts = 0
  while (attempts < maxAttempts) {
    attempts++
    const track = await selectNextTrack()
    if (!track) return null
    if (!isDuplicateForPlayback(track)) {
      trackBandPick(track)
      return track
    }
  }
  return null
}

async function prefetchQueueInternal(maxAttempts = 25): Promise<void> {
  const targetSize = Math.max(1, config.queueSize, config.prefetchThreshold)
  let attempts = 0
  while (getQueueSize() < targetSize && attempts < maxAttempts) {
    attempts++
    try {
      const track = await selectNextTrack()
      if (!track) break
      if (isDuplicateForPlayback(track)) continue
      enqueue(track)
      trackBandPick(track)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("Prefetch error:", message)
      // continue instead of break — individual YT failures shouldn't stop the whole pipeline
    }
  }
}

export async function prefetchQueue(maxAttempts = 25): Promise<void> {
  if (prefetchInFlight) return prefetchInFlight
  prefetchInFlight = prefetchQueueInternal(maxAttempts).finally(() => {
    prefetchInFlight = null
  })
  return prefetchInFlight
}

export function markPlaying(track: ResolvedTrack, logHistory = true): void {
  currentTrack = track
  isPlaying = true
  playbackStartedAt = Date.now()
  pausedAt = 0
  if (artistFocus && track.maId === artistFocus.maId) focusSeenVideoIds.add(track.videoId)
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
  const filtered = filterCanonical([...set])
  return filtered.length > 0 ? filtered.sort() : [...CANONICAL_GENRES]
}

export async function selectRandomGenre(): Promise<string> {
  const allGenres = await fetchGenresFromMA()
  if (allGenres.length === 0) return currentGenre
  const pick = allGenres[Math.floor(Math.random() * allGenres.length)]
  if (!pick) return currentGenre
  return pick
}

export async function fetchGenresFromMA(): Promise<string[]> {
  if (cachedGenres) return cachedGenres
  if (genresPromise) return genresPromise
  genresPromise = (async () => {
    try {
      const result = await runAdapter("browse-genres", [])
      const raw = (result?.genres?.length ? result.genres : []) as string[]
      const genres = raw.length > 0 ? filterCanonical(raw) : CANONICAL_GENRES
      cachedGenres = [...genres]
      console.log(`Fetched ${genres.length} canonical genres from MA (from ${raw.length} raw)`)
      return cachedGenres
    } catch (err) {
      console.warn("Failed to fetch genres from MA:", err)
      const fallback = [...CANONICAL_GENRES]
      cachedGenres = fallback
      return fallback
    } finally {
      genresPromise = null
    }
  })()
  return genresPromise
}
