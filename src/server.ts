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
  selectNextTrack,
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
  getRadioState,
} from "./scheduler"
import {
  getQueue,
  getHistory,
  dequeue,
  initRecentArtists,
  getQueueSize,
  clearQueue,
  findQueuedByVideoId,
  dropQueueUpTo,
} from "./queue"
import db, { type HistoryRow } from "./db"
import { resolveAnchor, lookupAnchorCandidates } from "./anchor"
import type { Mode, Spread, Anchor, Decade, ResolvedTrack } from "./types"
import { ALL_DECADES } from "./types"
import type { ServerWebSocket, Server } from "bun"
import { getFullGraph } from "./graph"
import { recordLike, recordDislike, getFeedback, listFeedback } from "./feedback"
import config from "./radio.config"
import { getLastMaError } from "./ma-client"

import indexHtml from "../frontend/index.html"

const startedAt = Date.now()
const clients = new Set<ServerWebSocket>()

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
  })
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
  "/api/radio/mode": ["POST"],
  "/api/radio/anchor": ["POST", "DELETE"],
  "/api/radio/spread": ["POST"],
  "/api/radio/genre": ["POST"],
  "/api/radio/random-genre": ["POST"],
  "/api/radio/decades": ["POST"],
  "/api/radio/jump": ["POST"],
  "/api/decades": ["GET"],
  "/api/artists/lookup": ["GET"],
  "/api/genres": ["GET"],
  "/api/genres/all": ["GET"],
  "/api/graph": ["GET"],
  "/api/artists/search": ["GET"],
  "/api/health": ["GET"],
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

async function playNextNow(): Promise<ResolvedTrack | null> {
  let item = dequeue()
  if (!item) {
    const track = await selectNextTrack()
    if (!track) return null
    item = { track, scheduledAt: Date.now(), playedAt: null }
  }
  markPlaying(item.track)
  broadcastTrackChange()
  broadcastState()
  void prefetchQueue().then(() => broadcastTrackChange()).catch(() => {})
  return item.track
}

async function handlePlayNext(): Promise<Response> {
  const track = await playNextNow()
  if (!track) return Response.json({ error: "No track available" }, { status: 404 })
  return Response.json({ current: getCurrentTrack() })
}

async function readArtistFromBody(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { artist?: string }
    if (body?.artist) return body.artist
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

  const allowed = ALLOWED_METHODS[path]
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
      const artist = (await readArtistFromBody(req)) ?? getCurrentTrack()?.artist ?? null
      if (!artist) return Response.json({ error: "No artist" }, { status: 400 })
      const entry = path.endsWith("like") ? recordLike(artist) : recordDislike(artist)
      return Response.json({ feedback: entry })
    }

    case "/api/radio/feedback": {
      const artist = url.searchParams.get("artist")
      if (artist) return Response.json({ feedback: getFeedback(artist) })
      return Response.json({ feedback: listFeedback() })
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
      let anchor: Anchor | null
      if (body.source === "ma" || body.source === "musicmap") {
        anchor = { source: body.source, sourceId: String(body.sourceId ?? ""), name: body.name }
        if (!anchor.sourceId) anchor = await resolveAnchor(body.name)
      } else {
        anchor = await resolveAnchor(body.name)
      }
      if (!anchor) {
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
      void prefetchQueue().then(() => broadcastTrackChange()).catch(() => {})
      return Response.json({ spread: getSpread() })
    }

    case "/api/radio/genre": {
      const body = (await req.json().catch(() => ({}))) as { genre?: string }
      if (!body.genre || typeof body.genre !== "string") {
        return Response.json({ error: "Missing genre" }, { status: 400 })
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
        if (row) {
          track = {
            videoId: row.video_id,
            title: row.title ?? "",
            artist: row.artist ?? "",
            genre: row.genre ?? "",
            country: row.country ?? "",
            duration: row.duration,
            source: (row.source ?? "library") as ResolvedTrack["source"],
            similarTo: row.similar_to || undefined,
            hopsFromAnchor: row.hops_from_anchor ?? undefined,
          }
        }
      }
      if (!track) return Response.json({ error: "Track not found" }, { status: 404 })
      schedulerResume()
      markPlaying(track, false)
      broadcastTrackChange()
      broadcastState()
      void prefetchQueue().then(() => broadcastTrackChange()).catch(() => {})
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
      return Response.json({ artists: matches })
    }

    case "/api/artists/lookup": {
      const q = url.searchParams.get("q") || ""
      if (!q.trim()) return Response.json({ candidates: [] })
      const candidates = await lookupAnchorCandidates(q)
      return Response.json({ candidates })
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

  await getYTClient()
  console.log("YouTube client ready")

  const server = Bun.serve({
    port: config.server.port,
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

  prefetchQueue()
    .then(() => console.log(`Queue populated: ${getQueue().length} tracks`))
    .catch((err) => console.warn("Prefetch failed (will retry on demand):", err.message))
}

startup().catch((err) => {
  console.error("Startup failed:", err)
  process.exit(1)
})
