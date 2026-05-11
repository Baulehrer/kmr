import { loadLibrary, getAllArtists } from "./library"
import { getClient as getYTClient } from "./yt-client"
import {
  getCurrentGenre,
  setGenre,
  getCurrentCountry,
  setCountry,
  clearCountry,
  getCurrentTrack,
  getIsPlaying,
  pause as schedulerPause,
  resume as schedulerResume,
  prefetchQueue,
  selectNextTrack,
  markPlaying,
  getAvailableGenres,
  getAvailableCountries,
} from "./scheduler"
import { getQueue, getHistory } from "./queue"
import { getFullGraph } from "./graph"
import config from "./radio.config"

async function handlePlayNext(): Promise<Response> {
  const track = await selectNextTrack()
  if (!track) {
    return Response.json({ error: "No track available" }, { status: 404 })
  }
  markPlaying(track)
  void prefetchQueue()
  return Response.json({ current: { ...getCurrentTrack() } })
}

async function router(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method

  if (path.startsWith("/api/")) {
    try {
      return await handleApi(path, method, req)
    } catch (err: any) {
      console.error(`API error: ${path}`, err)
      return Response.json({ error: err.message || "Internal error" }, { status: 500 })
    }
  }

  return Response.json({ error: "Not found" }, { status: 404 })
}

async function handleApi(path: string, method: string, req: Request): Promise<Response> {
  switch (path) {
    case "/api/radio/current": {
      const current = getCurrentTrack()
      return Response.json({ current })
    }

    case "/api/radio/next": {
      return await handlePlayNext()
    }

    case "/api/radio/skip": {
      if (method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 })
      return await handlePlayNext()
    }

    case "/api/radio/pause": {
      if (method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 })
      schedulerPause()
      return Response.json({ paused: true })
    }

    case "/api/radio/resume": {
      if (method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 })
      schedulerResume()
      return Response.json({ resumed: true })
    }

    case "/api/radio/history": {
      const history = getHistory(200)
      return Response.json({ history })
    }

    case "/api/radio/queue": {
      const queue = getQueue()
      return Response.json({ queue })
    }

    case "/api/genres": {
      const genres = getAvailableGenres()
      return Response.json({ genres })
    }

    case "/api/countries": {
      const countries = getAvailableCountries()
      return Response.json({ countries })
    }

    case "/api/genre": {
      if (method === "GET") {
        return Response.json({ genre: getCurrentGenre() })
      }
      if (method === "POST") {
        const body = await req.json() as { genre?: string }
        if (!body.genre) {
          return Response.json({ error: "Missing genre" }, { status: 400 })
        }
        setGenre(body.genre)
        return Response.json({ genre: getCurrentGenre() })
      }
      return Response.json({ error: "Method not allowed" }, { status: 405 })
    }

    case "/api/country": {
      if (method === "GET") {
        return Response.json({ country: getCurrentCountry() || "any" })
      }
      if (method === "POST") {
        const body = await req.json() as { country?: string }
        if (!body.country) {
          clearCountry()
          return Response.json({ country: "any" })
        }
        setCountry(body.country)
        return Response.json({ country: getCurrentCountry() })
      }
      return Response.json({ error: "Method not allowed" }, { status: 405 })
    }

    case "/api/graph": {
      const graph = getFullGraph()
      return Response.json(graph)
    }

    case "/api/artists/search": {
      const url = new URL(req.url)
      const q = url.searchParams.get("q") || ""
      if (!q) return Response.json({ artists: [] })

      const libraryMatches = getAllArtists().filter((a) =>
        a.name.toLowerCase().includes(q.toLowerCase())
      )

      return Response.json({
        artists: libraryMatches.map((a) => ({
          name: a.name,
          maId: a.maId,
          genres: a.genres,
          country: a.country,
        })),
      })
    }

    default:
      return Response.json({ error: "Not found" }, { status: 404 })
  }
}

async function startup() {
  console.log("=== Radio Engine Starting ===")

  loadLibrary()
  console.log(`Library: ${getAllArtists().length} artists loaded`)

  await getYTClient()
  console.log("YouTube client ready")

  const server = Bun.serve({
    port: config.server.port,
    fetch: router,
  })

  console.log(`Radio server running on http://localhost:${server.port}`)
  console.log(`Genre: ${getCurrentGenre()}`)
  console.log(`Country: ${getCurrentCountry() || "any"}`)

  prefetchQueue()
    .then(() => console.log(`Queue populated: ${getQueue().length} tracks`))
    .catch((err) => console.warn("Prefetch failed (will retry on demand):", err.message))
}

startup().catch((err) => {
  console.error("Startup failed:", err)
  process.exit(1)
})
