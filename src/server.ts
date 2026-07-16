import { loadLibrary, getAllArtists, getLibrarySize } from "./library"
import { getClient as getYTClient } from "./yt-client"
import {
  getCurrentGenre,
  setGenre,
  getCurrentTrack,
  getIsPlaying,
  pause as schedulerPause,
  resume as schedulerResume,
  prefetchQueue,
  selectPlayableTrack,
  markPlaying,
  getAvailableGenres,
  fetchGenresFromMA,
  selectRandomGenre,
  getMode,
  setMode,
  getAnchor,
  setAnchor,
  getSpread,
  setSpread,
  getDecades,
  setDecades,
  getAnchorFrequency,
  setAnchorFrequency,
  getRadioState,
  startArtistFocus,
  stopArtistFocus,
  getReleaseTypes,
  setReleaseTypes,
  getCountry,
  setCountry,
  getTopCountries,
} from "./scheduler"
import {
  getQueue,
  getHistory,
  dequeue,
  initRecentArtists,
  getQueueSize,
  findQueuedByVideoId,
  dropQueueUpTo,
} from "./queue"
import db, { type HistoryRow } from "./db"
import { resolveAnchor, resolveAnchorCandidate, lookupAnchorCandidates } from "./anchor"
import type { Mode, Spread, Anchor, Decade, ResolvedTrack, ReleaseTypeFilter } from "./types"
import { ALL_DECADES, ALL_RELEASE_TYPES } from "./types"
import type { ServerWebSocket, Server } from "bun"
import { getFullGraph } from "./graph"
import { recordLike, recordDislike, getFeedback, listFeedback } from "./feedback"
import config from "./radio.config"
import { getArtistDetail, getArtistDiscography, getLastMaError, getMaArtwork, getReleaseDetail, getSimilarArtists, searchArtistsBroad } from "./ma-client"
import { CANONICAL_GENRES, normalizeName } from "./genre"
import { getLyrics } from "./lyrics"
import { getVideoLoudnessDb } from "./yt-client"

import indexHtml from "../frontend/index.html"

const startedAt = Date.now()
const clients = new Set<ServerWebSocket>()
let playNextInFlight: Promise<ResolvedTrack | null> | null = null

function broadcast(type: string, payload: Record<string, unknown>): void {
  const msg = JSON.stringify({ type, ...payload })
  for (const ws of clients) {
    ws.send(msg)
  }
}

function broadcastTrackChange(): void {
  broadcast("track", {
    current: getCurrentTrack(),
    queue: getQueue().map((q) => q.track),
    history: getHistory(10),
  })
}

function broadcastState(): void {
  const state = getRadioState()
  broadcast("state", {
    playing: state.playing,
    genre: state.genre,
    mode: state.mode,
    anchor: state.anchor,
    spread: state.spread,
    decades: state.decades,
    anchorFrequency: state.anchorFrequency,
    artistFocus: state.artistFocus,
    releaseTypes: state.releaseTypes,
    country: state.country,
  })
}

function broadcastQueueStatus(loading: boolean, message = ""): void {
  broadcast("queue-status", { loading, message, queueSize: getQueueSize() })
}

async function refillQueue(): Promise<void> {
  broadcastQueueStatus(true, "Nächste Platte wird gesucht …")
  try {
    await prefetchQueue()
    broadcastTrackChange()
    broadcastQueueStatus(false, getQueueSize() > 0 ? "" : "Für diese Auswahl wurde noch kein weiterer Titel gefunden.")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    broadcastQueueStatus(false, `Nachladen fehlgeschlagen: ${message}`)
  }
}

const ALLOWED_METHODS: Record<string, string[]> = {
  "/api/radio/current": ["GET"],
  "/api/radio/next": ["POST"],
  "/api/radio/skip": ["POST"],
  "/api/radio/pause": ["POST"],
  "/api/radio/resume": ["POST"],
  "/api/radio/history": ["GET"],
  "/api/radio/queue": ["GET"],
  "/api/radio/like": ["POST"],
  "/api/radio/dislike": ["POST"],
  "/api/radio/feedback": ["GET"],
  "/api/radio/state": ["GET"],
  "/api/radio/configure": ["POST"],
  "/api/radio/mode": ["POST"],
  "/api/radio/anchor": ["POST", "DELETE"],
  "/api/radio/spread": ["POST"],
  "/api/radio/genre": ["POST"],
  "/api/radio/random-genre": ["POST"],
  "/api/radio/anchor-frequency": ["POST"],
  "/api/radio/decades": ["POST"],
  "/api/radio/lyrics": ["GET"],
  "/api/radio/artist-focus": ["POST", "DELETE"],
  "/api/radio/loudness": ["GET"],
  "/api/radio/release-types": ["POST"],
  "/api/radio/country": ["POST"],
  "/api/radio/jump": ["POST"],
  "/api/decades": ["GET"],
  "/api/countries": ["GET"],
  "/api/artists/lookup": ["GET"],
  "/api/genres": ["GET"],
  "/api/genres/all": ["GET"],
  "/api/graph": ["GET"],
  "/api/artists/search": ["GET"],
  "/api/health": ["GET"],
  "/api/ma/search": ["GET"],
  "/api/ma/artwork": ["GET"],
}

function allowedMethods(path: string): string[] | undefined {
  const direct = ALLOWED_METHODS[path]
  if (direct) return direct
  if (/^\/api\/ma\/artists\/\d+$/.test(path)) return ["GET"]
  if (/^\/api\/ma\/artists\/\d+\/releases\/\d+$/.test(path)) return ["GET"]
  return undefined
}

function isMode(v: unknown): v is Mode {
  return v === "band" || v === "genre"
}

function isSpread(v: unknown): v is Spread {
  return v === "narrow" || v === "medium" || v === "wide"
}

function isDecade(v: unknown): v is Decade {
  return typeof v === "string" && (ALL_DECADES as string[]).includes(v)
}

function isReleaseType(v: unknown): v is ReleaseTypeFilter {
  return typeof v === "string" && (ALL_RELEASE_TYPES as string[]).includes(v)
}

async function playNextNowInternal(): Promise<ResolvedTrack | null> {
  let item = dequeue()
  if (!item) {
    broadcastQueueStatus(true, "Nächste Platte wird gesucht …")
    const track = await selectPlayableTrack()
    if (!track) {
      broadcastQueueStatus(false, "Für diese Auswahl wurde kein weiterer Titel gefunden.")
      return null
    }
    item = { track, scheduledAt: Date.now(), playedAt: null }
  }
  markPlaying(item.track)
  broadcastTrackChange()
  broadcastState()
  broadcastQueueStatus(false)
  void refillQueue()
  return item.track
}

async function playNextNow(): Promise<ResolvedTrack | null> {
  if (playNextInFlight) return playNextInFlight
  playNextInFlight = playNextNowInternal().finally(() => {
    playNextInFlight = null
  })
  return playNextInFlight
}

async function handlePlayNext(): Promise<Response> {
  const track = await playNextNow()
  if (!track) return Response.json({ error: "No track available" }, { status: 404 })
  return Response.json({ current: getCurrentTrack() })
}

async function readArtistFromBody(req: Request): Promise<{ artist: string; maId?: number } | null> {
  try {
    const body = (await req.json()) as { artist?: string; maId?: number }
    if (body?.artist) return { artist: body.artist, maId: Number.isInteger(body.maId) ? body.maId : undefined }
  } catch {
    return null // invalid JSON
  }
  return null
}

function buildHealth() {
  const counts = {
    ma_artists: (db.query("SELECT COUNT(*) as c FROM ma_artists").get() as { c: number }).c,
    ma_similar: (db.query("SELECT COUNT(*) as c FROM ma_similar").get() as { c: number }).c,
    graph_nodes: (db.query("SELECT COUNT(*) as c FROM graph_nodes").get() as { c: number }).c,
    graph_edges: (db.query("SELECT COUNT(*) as c FROM graph_edges").get() as { c: number }).c,
    history: (db.query("SELECT COUNT(*) as c FROM history").get() as { c: number }).c,
    feedback: (db.query("SELECT COUNT(*) as c FROM artist_feedback").get() as { c: number }).c,
  }
  return {
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    library: getLibrarySize(),
    queue: getQueueSize(),
    clients: clients.size,
    playing: getIsPlaying(),
    currentArtist: getCurrentTrack()?.artist ?? null,
    genre: getCurrentGenre(),
    mode: getMode(),
    anchor: getAnchor(),
    spread: getSpread(),
    decades: getDecades(),
    cache: counts,
    lastMaError: getLastMaError(),
  }
}

async function router(this: Server<undefined>, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method

  if (path === "/ws") {
    const success = this.upgrade(req)
    if (success) return new Response(null, { status: 101 }) as unknown as Response
    return Response.json({ error: "Upgrade failed" }, { status: 500 })
  }

  if (!path.startsWith("/api/")) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const allowed = allowedMethods(path)
  if (!allowed) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }
  if (!allowed.includes(method)) {
    return Response.json({ error: "Method not allowed" }, {
      status: 405,
      headers: { Allow: allowed.join(", ") },
    })
  }

  try {
    return await handleApi(path, method, req, url)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error"
    console.error(`API error: ${path}`, err)
    return Response.json({ error: message }, { status: 500 })
  }
}

async function handleApi(path: string, method: string, req: Request, url: URL): Promise<Response> {
  const artistMatch = path.match(/^\/api\/ma\/artists\/(\d+)$/)
  if (artistMatch) {
    const maId = Number(artistMatch[1])
    const [artist, releases, similar] = await Promise.all([
      getArtistDetail(maId),
      getArtistDiscography(maId),
      getSimilarArtists(maId),
    ])
    if (!artist) return Response.json({ error: "Band nicht gefunden" }, { status: 404 })
    return Response.json({ artist, releases, similar })
  }
  const releaseMatch = path.match(/^\/api\/ma\/artists\/(\d+)\/releases\/(\d+)$/)
  if (releaseMatch) {
    const detail = await getReleaseDetail(Number(releaseMatch[1]), Number(releaseMatch[2]))
    return detail ? Response.json(detail) : Response.json({ error: "Album nicht gefunden" }, { status: 404 })
  }

  switch (path) {
    case "/api/radio/current":
      return Response.json({ current: getCurrentTrack() })

    case "/api/radio/next":
    case "/api/radio/skip": {
      if (!getIsPlaying()) schedulerResume()
      return await handlePlayNext()
    }

    case "/api/radio/pause":
      schedulerPause()
      broadcastState()
      return Response.json({ paused: true })

    case "/api/radio/resume":
      schedulerResume()
      broadcastState()
      return Response.json({ resumed: true })

    case "/api/radio/history":
      return Response.json({ history: getHistory(200) })

    case "/api/radio/queue":
      return Response.json({ queue: getQueue() })

    case "/api/radio/like":
    case "/api/radio/dislike": {
      const requested = await readArtistFromBody(req)
      const current = getCurrentTrack()
      const artist = requested?.artist ?? current?.artist ?? null
      const maId = requested?.maId ?? current?.maId
      if (!artist || !maId) return Response.json({ error: "No verified artist" }, { status: 400 })
      const entry = path.endsWith("like") ? recordLike(artist, maId) : recordDislike(artist, maId)
      return Response.json({ feedback: entry })
    }

    case "/api/radio/feedback": {
      const artist = url.searchParams.get("artist")
      const maId = Number(url.searchParams.get("maId")) || undefined
      if (artist) return Response.json({ feedback: getFeedback(artist, maId) })
      return Response.json({ feedback: listFeedback() })
    }

    case "/api/radio/lyrics": {
      const current = getCurrentTrack()
      if (!current) return Response.json({ error: "Kein Titel läuft" }, { status: 404 })
      return Response.json(await getLyrics(current))
    }

    case "/api/radio/loudness": {
      const current = getCurrentTrack()
      if (!current) return Response.json({ error: "Kein Titel läuft" }, { status: 404 })
      return Response.json({ videoId: current.videoId, loudnessDb: await getVideoLoudnessDb(current.videoId) })
    }

    case "/api/radio/artist-focus": {
      if (method === "DELETE") {
        stopArtistFocus()
        broadcastState()
        void refillQueue()
        return Response.json({ artistFocus: null })
      }
      const body = (await req.json().catch(() => ({}))) as { maId?: number; videoId?: string }
      if (!Number.isInteger(body.maId) || !body.videoId) {
        return Response.json({ error: "Der laufende Artist konnte nicht bestätigt werden" }, { status: 400 })
      }
      const focus = startArtistFocus(body.maId!, body.videoId)
      if (!focus) return Response.json({ error: "Der Titel hat inzwischen gewechselt" }, { status: 409 })
      broadcastState()
      void refillQueue()
      return Response.json({ artistFocus: focus })
    }

    case "/api/radio/state": {
      const state = getRadioState()
      return Response.json({
        ...state,
        current: getCurrentTrack(),
        queue: getQueue().map((q) => q.track),
        history: getHistory(10),
      })
    }

    case "/api/radio/configure": {
      const body = (await req.json().catch(() => ({}))) as {
        mode?: unknown
        anchor?: null | { source?: unknown; sourceId?: unknown; name?: unknown }
        spread?: unknown
        genre?: unknown
        decades?: unknown
        anchorFrequency?: unknown
        releaseTypes?: unknown
        country?: unknown
      }
      if (!isMode(body.mode)) return Response.json({ error: "Ungültiger Radiomodus" }, { status: 400 })
      if (!isSpread(body.spread)) return Response.json({ error: "Ungültige Ähnlichkeit" }, { status: 400 })
      if (typeof body.genre !== "string" || !(CANONICAL_GENRES as readonly string[]).includes(body.genre)) {
        return Response.json({ error: "Ungültiges Genre" }, { status: 400 })
      }
      if (!Array.isArray(body.decades) || !body.decades.every(isDecade)) {
        return Response.json({ error: "Ungültige Jahrzehnte" }, { status: 400 })
      }
      if (!Array.isArray(body.releaseTypes) || body.releaseTypes.length === 0 || !body.releaseTypes.every(isReleaseType)) {
        return Response.json({ error: "Mindestens eine Veröffentlichungsart ist erforderlich" }, { status: 400 })
      }
      const frequency = Number(body.anchorFrequency)
      if (!Number.isFinite(frequency) || frequency < 0 || frequency > 100) {
        return Response.json({ error: "Ungültiger Wunschband-Anteil" }, { status: 400 })
      }
      if (typeof body.country !== "string" || (body.country && !getTopCountries().includes(body.country))) {
        return Response.json({ error: "Ungültiges Land" }, { status: 400 })
      }

      let nextAnchor: Anchor | null = null
      if (body.anchor !== null && body.anchor !== undefined) {
        if (body.anchor.source !== "ma" || typeof body.anchor.sourceId !== "string" || typeof body.anchor.name !== "string") {
          return Response.json({ error: "Ungültige Wunschband" }, { status: 400 })
        }
        const existing = getAnchor()
        nextAnchor = existing?.sourceId === body.anchor.sourceId && normalizeName(existing.name) === normalizeName(body.anchor.name)
          ? existing
          : await resolveAnchorCandidate(body.anchor.name, body.anchor.sourceId)
        if (!nextAnchor) return Response.json({ error: "Wunschband konnte nicht bestätigt werden" }, { status: 400 })
      }
      if (body.mode === "band" && !nextAnchor) {
        return Response.json({ error: "Bitte zuerst eine Wunschband auswählen" }, { status: 400 })
      }

      stopArtistFocus()
      setMode(body.mode)
      setAnchor(nextAnchor)
      setSpread(body.spread)
      setGenre(body.genre)
      setDecades(body.decades)
      setAnchorFrequency(frequency)
      setReleaseTypes(body.releaseTypes)
      setCountry(body.country)
      broadcastState()
      void playNextNow().then(async (track) => track ?? await playNextNow()).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`Radio start failed: ${message}`)
        broadcastQueueStatus(false, "Für diese Auswahl wurde noch kein Titel gefunden.")
      })
      const state = getRadioState()
      return Response.json({
        ...state,
        accepted: true,
        pending: true,
        current: getCurrentTrack(),
        queue: getQueue().map((item) => item.track),
        history: getHistory(10),
      }, { status: 202 })
    }

    case "/api/radio/release-types": {
      const body = (await req.json().catch(() => ({}))) as { releaseTypes?: unknown }
      if (!Array.isArray(body.releaseTypes) || body.releaseTypes.length === 0 || !body.releaseTypes.every(isReleaseType)) {
        return Response.json({ error: "Mindestens ein gültiger Release-Typ ist erforderlich" }, { status: 400 })
      }
      setReleaseTypes(body.releaseTypes)
      broadcastState()
      void refillQueue()
      return Response.json({ releaseTypes: getReleaseTypes() })
    }

    case "/api/radio/country": {
      const body = (await req.json().catch(() => ({}))) as { country?: unknown }
      if (typeof body.country !== "string") return Response.json({ error: "Ungültiges Land" }, { status: 400 })
      const allowed = getTopCountries()
      if (body.country && !allowed.includes(body.country)) return Response.json({ error: "Land ist nicht in der Top-20-Auswahl" }, { status: 400 })
      setCountry(body.country)
      broadcastState()
      void refillQueue()
      return Response.json({ country: getCountry() })
    }

    case "/api/radio/mode": {
      const body = (await req.json().catch(() => ({}))) as { mode?: string }
      if (!isMode(body.mode)) return Response.json({ error: "Invalid mode" }, { status: 400 })
      setMode(body.mode)
      broadcastState()
      await playNextNow()
      return Response.json({ mode: getMode() })
    }

    case "/api/radio/anchor": {
      if (method === "DELETE") {
        setAnchor(null)
        broadcastState()
        return Response.json({ anchor: null })
      }
      const body = (await req.json().catch(() => ({}))) as { name?: string; source?: string; sourceId?: string }
      if (!body.name || typeof body.name !== "string") {
        return Response.json({ error: "Missing name" }, { status: 400 })
      }
      let anchor: Anchor | null = null
      if (body.sourceId) {
        if (body.source !== "ma") return Response.json({ error: "Only Metal Archives artists are allowed" }, { status: 400 })
        anchor = await resolveAnchorCandidate(body.name, body.sourceId)
      } else {
        anchor = await resolveAnchor(body.name)
      }
      if (!anchor) {
        if (body.sourceId) {
          return Response.json({ error: "Invalid Metal Archives artist identity" }, { status: 400 })
        }
        const candidates = await lookupAnchorCandidates(body.name)
        const exact = candidates.filter((candidate) => normalizeName(candidate.name) === normalizeName(body.name!))
        if (exact.length > 1) {
          return Response.json({ error: "Mehrere gleichnamige Bands gefunden – bitte auswählen", candidates: exact }, { status: 409 })
        }
        return Response.json({ error: "Artist not found", queried: body.name }, { status: 404 })
      }
      setAnchor(anchor)
      broadcastState()
      await playNextNow()
      return Response.json({ anchor })
    }

    case "/api/radio/spread": {
      const body = (await req.json().catch(() => ({}))) as { spread?: string }
      if (!isSpread(body.spread)) return Response.json({ error: "Invalid spread" }, { status: 400 })
      setSpread(body.spread)
      broadcastState()
      void refillQueue()
      return Response.json({ spread: getSpread() })
    }

    case "/api/radio/anchor-frequency": {
      const body = (await req.json().catch(() => ({}))) as { frequency?: number }
      const freq = Number(body.frequency)
      if (!Number.isFinite(freq) || freq < 0 || freq > 100) {
        return Response.json({ error: "Invalid frequency (0-100)" }, { status: 400 })
      }
      setAnchorFrequency(freq)
      broadcastState()
      void refillQueue()
      return Response.json({ anchorFrequency: getAnchorFrequency() })
    }

    case "/api/radio/genre": {
      const body = (await req.json().catch(() => ({}))) as { genre?: string }
      if (!body.genre || typeof body.genre !== "string") {
        return Response.json({ error: "Missing genre" }, { status: 400 })
      }
      if (!(CANONICAL_GENRES as readonly string[]).includes(body.genre)) {
        return Response.json({ error: "Invalid genre" }, { status: 400 })
      }
      setGenre(body.genre)
      broadcastState()
      await playNextNow()
      return Response.json({ genre: getCurrentGenre() })
    }

    case "/api/radio/random-genre": {
      const randomGenre = await selectRandomGenre()
      if (!randomGenre || randomGenre === getCurrentGenre()) {
        return Response.json({ genre: getCurrentGenre() })
      }
      setGenre(randomGenre)
      broadcastState()
      await playNextNow()
      return Response.json({ genre: getCurrentGenre() })
    }

    case "/api/radio/decades": {
      const body = (await req.json().catch(() => ({}))) as { decades?: unknown }
      if (!Array.isArray(body.decades) || !body.decades.every(isDecade)) {
        return Response.json({ error: "Invalid decades" }, { status: 400 })
      }
      setDecades(body.decades)
      broadcastState()
      await playNextNow()
      return Response.json({ decades: getDecades() })
    }

    case "/api/decades":
      return Response.json({ decades: ALL_DECADES })

    case "/api/countries":
      return Response.json({ countries: getTopCountries() })

    case "/api/radio/jump": {
      const body = (await req.json().catch(() => ({}))) as { videoId?: string }
      if (!body.videoId || typeof body.videoId !== "string") {
        return Response.json({ error: "Missing videoId" }, { status: 400 })
      }
      const queued = findQueuedByVideoId(body.videoId)
      let track: ResolvedTrack | null = null
      if (queued) {
        dropQueueUpTo(queued.index + 1)
        track = queued.track
      } else {
        const row = db
          .query("SELECT * FROM history WHERE video_id = ? ORDER BY played_at DESC LIMIT 1")
          .get(body.videoId) as HistoryRow | undefined
        if (row?.ma_id && row.ma_id > 0) {
          track = {
            maId: row.ma_id,
            videoId: row.video_id,
            title: row.title ?? "",
            videoTitle: row.video_title || undefined,
            albumId: row.album_id || undefined,
            album: row.album || undefined,
            artist: row.artist ?? "",
            genre: row.genre ?? "",
            country: row.country ?? "",
            duration: row.duration,
            source: (row.source ?? "library") as ResolvedTrack["source"],
            similarTo: row.similar_to || undefined,
            hopsFromAnchor: row.hops_from_anchor ?? undefined,
            selectionReason: row.selection_reason || undefined,
          }
        }
      }
      if (!track) return Response.json({ error: "Track not found" }, { status: 404 })
      schedulerResume()
      markPlaying(track, false)
      broadcastTrackChange()
      broadcastState()
      void refillQueue()
      return Response.json({ current: getCurrentTrack() })
    }

    case "/api/genres":
      return Response.json({ genres: getAvailableGenres() })

    case "/api/genres/all":
      return Response.json({ genres: await fetchGenresFromMA() })

    case "/api/graph":
      return Response.json(getFullGraph())

    case "/api/artists/search": {
      const q = url.searchParams.get("q") || ""
      if (!q) return Response.json({ artists: [] })
      const needle = q.toLowerCase()
      const matches = getAllArtists()
        .filter((a) => a.name.toLowerCase().includes(needle))
        .map((a) => ({ name: a.name, maId: a.maId, genres: a.genres, country: a.country }))
      // Fallback: search ma_artists for artists not in local library
      if (matches.length === 0 || !matches.some((m) => m.maId)) {
        const dbRows = db
          .query("SELECT ma_id, name, genre, country FROM ma_artists WHERE name_key LIKE ? LIMIT 5")
          .all(`%${needle}%`) as { ma_id: number; name: string; genre: string | null; country: string | null }[]
        for (const row of dbRows) {
          if (!matches.some((m) => m.maId === row.ma_id)) {
            matches.push({ name: row.name, maId: row.ma_id, genres: row.genre ? [row.genre] : [], country: row.country ?? "" })
          }
        }
      }
      return Response.json({ artists: matches })
    }

    case "/api/artists/lookup": {
      const q = url.searchParams.get("q") || ""
      if (!q.trim()) return Response.json({ candidates: [] })
      const candidates = await lookupAnchorCandidates(q)
      return Response.json({ candidates })
    }

    case "/api/ma/search": {
      const q = (url.searchParams.get("q") || "").trim()
      if (q.length < 2) return Response.json({ artists: [] })
      return Response.json({ artists: await searchArtistsBroad(q) })
    }

    case "/api/ma/artwork": {
      const artwork = await getMaArtwork(url.searchParams.get("url") || "")
      if (!artwork) return Response.json({ error: "Bild nicht verfügbar" }, { status: 404 })
      const bytes = Uint8Array.from(artwork.body)
      return new Response(bytes.buffer, {
        headers: { "Content-Type": artwork.contentType, "Cache-Control": "public, max-age=86400" },
      })
    }

    case "/api/health":
      return Response.json(buildHealth())

    default:
      return Response.json({ error: "Not found" }, { status: 404 })
  }
}

async function startup(): Promise<void> {
  console.log("=== Radio Engine Starting ===")

  loadLibrary()
  console.log(`Library: ${getAllArtists().length} artists loaded`)

  initRecentArtists(config.repeatProtection)
  console.log("Recent artists restored from history")

  try {
    await getYTClient()
    console.log("YouTube client ready")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`YouTube client not ready at startup (will retry on demand): ${message}`)
  }

  const server = Bun.serve({
    port: config.server.port,
    hostname: process.env.KMR_HOST || undefined,
    idleTimeout: 60,
    routes: {
      "/": indexHtml,
    },
    fetch: router,
    websocket: {
      open(ws: ServerWebSocket) {
        clients.add(ws)
        const state = getRadioState()
        ws.send(JSON.stringify({
          type: "init",
          current: getCurrentTrack(),
          playing: state.playing,
          genre: state.genre,
          mode: state.mode,
          anchor: state.anchor,
          spread: state.spread,
          decades: state.decades,
          anchorFrequency: state.anchorFrequency,
          artistFocus: state.artistFocus,
          releaseTypes: state.releaseTypes,
          country: state.country,
          queue: getQueue().map((q) => q.track),
          history: getHistory(10),
        }))
      },
      close(ws: ServerWebSocket) {
        clients.delete(ws)
      },
      message(ws: ServerWebSocket, msg: string | Buffer) {
        try {
          const data = JSON.parse(msg.toString())
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }))
          }
        } catch {}
      },
    },
  })

  console.log(`Radio server running on http://localhost:${server.port}`)
  const state = getRadioState()
  console.log(`Mode: ${state.mode} | Spread: ${state.spread} | Genre: ${state.genre} | Anchor: ${state.anchor?.name ?? "(none)"}`)

  refillQueue()
    .then(() => console.log(`Queue populated: ${getQueue().length} tracks`))
    .catch((err) => console.warn("Prefetch failed (will retry on demand):", err.message))
}

startup().catch((err) => {
  console.error("Startup failed:", err)
  process.exit(1)
})
