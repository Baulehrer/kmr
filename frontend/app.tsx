import React from "react"
import { createRoot } from "react-dom/client"
import "./app.css"

interface Track {
  videoId: string
  title: string
  artist: string
  genre: string
  country: string
  duration: number
  source: "library" | "similar" | "discovery"
  similarTo?: string
  hopsFromAnchor?: number
  progress?: number
}

type Mode = "band" | "genre"
type Spread = "narrow" | "medium" | "wide"
type Decade = "70s" | "80s" | "90s" | "00s" | "10s" | "20s"

interface Anchor {
  source: "ma" | "musicmap"
  sourceId: string
  name: string
}

interface AnchorCandidate {
  source: "ma" | "musicmap"
  sourceId: string
  name: string
  hint: string
}

type ViewName = "vinyl" | "cards" | "compact"
const ALL_VIEWS: { value: ViewName; label: string }[] = [
  { value: "vinyl", label: "Vinyl" },
  { value: "cards", label: "Karten" },
  { value: "compact", label: "Kompakt" },
]

type ThemeName =
  | "classic" | "midnight" | "forest" | "sunset" | "lavender"
  | "mono" | "vapor" | "paper" | "terminal" | "gold"
const ALL_THEMES: { value: ThemeName; label: string }[] = [
  { value: "classic", label: "Classic Metal" },
  { value: "midnight", label: "Midnight" },
  { value: "forest", label: "Forest" },
  { value: "sunset", label: "Sunset" },
  { value: "lavender", label: "Lavender" },
  { value: "mono", label: "Mono" },
  { value: "vapor", label: "Vapor" },
  { value: "paper", label: "Paper" },
  { value: "terminal", label: "Terminal" },
  { value: "gold", label: "Gold" },
]

const ALL_DECADES: Decade[] = ["70s", "80s", "90s", "00s", "10s", "20s"]
const DECADE_LABELS: Record<Decade, string> = {
  "70s": "70er",
  "80s": "80er",
  "90s": "90er",
  "00s": "2000er",
  "10s": "2010er",
  "20s": "2020er",
}
const SPREAD_LABELS: Record<Spread, string> = {
  narrow: "Eng",
  medium: "Mittel",
  wide: "Weit",
}

interface YTPlayerLike {
  loadVideoById(id: string | { videoId: string; startSeconds?: number }): void
  cueVideoById?(id: string | { videoId: string; startSeconds?: number }): void
  seekTo(seconds: number, allowSeekAhead?: boolean): void
  setVolume(v: number): void
  pauseVideo(): void
  playVideo(): void
  getCurrentTime(): number
  getPlayerState(): number
  getVideoData(): { video_id: string; title: string }
  destroy(): void
}

const YT_ENDED = 0

function loadYTApi(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as any
    if (w.YT?.Player) {
      resolve()
      return
    }
    const tag = document.createElement("script")
    tag.src = "https://www.youtube.com/iframe_api"
    document.head.appendChild(tag)
    w.onYouTubeIframeAPIReady = () => resolve()
  })
}

function formatTime(s: number): string {
  if (!s || s <= 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

function Thumb({ videoId }: { videoId: string }) {
  const [errored, setErrored] = React.useState(false)
  if (errored) return <div className="thumb" />
  return (
    <img
      className="thumb"
      src={`https://img.youtube.com/vi/${videoId}/default.jpg`}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
    />
  )
}

interface VinylDiscProps {
  track: Track | null
  size: "large" | "small"
  spinning?: boolean
  position?: "history" | "queue" | "center"
  distance?: number
  onClick?: () => void
}

function VinylDisc({ track, size, spinning, position, distance = 0, onClick }: VinylDiscProps) {
  const [errored, setErrored] = React.useState(false)
  const src = track?.videoId ? `https://img.youtube.com/vi/${track.videoId}/mqdefault.jpg` : null
  const scale = size === "large" ? 1 : Math.max(0.55, 1 - distance * 0.08)
  const opacity = size === "large" ? 1 : Math.max(0.35, 1 - distance * 0.12)
  const title = track ? `${track.artist} — ${track.title}` : ""
  return (
    <button
      type="button"
      className={`vinyl-disc vinyl-${size}${spinning ? " spinning" : ""}${position ? " vinyl-" + position : ""}`}
      style={{ transform: `scale(${scale})`, opacity }}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={!track || !onClick}
    >
      <span className="vinyl-grooves" aria-hidden />
      {src && !errored ? (
        <img className="vinyl-art" src={src} alt="" onError={() => setErrored(true)} />
      ) : (
        <span className="vinyl-art vinyl-art-blank" />
      )}
      <span className="vinyl-hole" aria-hidden />
    </button>
  )
}

function App() {
  const playerRef = React.useRef<YTPlayerLike | null>(null)
  const playerReadyRef = React.useRef(false)
  const pendingVideoIdRef = React.useRef<string | null>(null)
  const pendingAutoplayRef = React.useRef(true)
  const pendingStartSecondsRef = React.useRef<number | undefined>(undefined)
  const currentVideoIdRef = React.useRef<string | null>(null)
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const playNextRef = React.useRef<() => void>(() => {})
  const playPrevRef = React.useRef<() => void>(() => {})
  const togglePauseRef = React.useRef<() => void>(() => {})
  const volumeRef = React.useRef(80)
  const wsRef = React.useRef<WebSocket | null>(null)
  const reconnectRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnectRef = React.useRef(true)
  const progressBarRef = React.useRef<HTMLDivElement | null>(null)
  const seekingRef = React.useRef(false)
  const showControlsRef = React.useRef(false)

  const [current, setCurrent] = React.useState<Track | null>(null)
  const [progress, setProgress] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [volume, setVolume] = React.useState(80)
  const [genre, setGenre] = React.useState("")
  const [genres, setGenres] = React.useState<string[]>([])
  const [mode, setMode] = React.useState<Mode>("genre")
  const [anchor, setAnchor] = React.useState<Anchor | null>(null)
  const [anchorFrequency, setAnchorFrequency] = React.useState(0)
  const [spread, setSpread] = React.useState<Spread>("medium")
  const [decades, setDecades] = React.useState<Decade[]>([])
  const [anchorQuery, setAnchorQuery] = React.useState("")
  const [anchorCandidates, setAnchorCandidates] = React.useState<AnchorCandidate[]>([])
  const [anchorSearching, setAnchorSearching] = React.useState(false)
  const [anchorError, setAnchorError] = React.useState<string | null>(null)
  const [queue, setQueue] = React.useState<Track[]>([])
  const [history, setHistory] = React.useState<Track[]>([])
  const [connected, setConnected] = React.useState(false)
  const [showVideo, setShowVideo] = React.useState(false)
  const [showControls, setShowControls] = React.useState(false)
  const [view, setView] = React.useState<ViewName>(() => {
    const v = (typeof localStorage !== "undefined" && localStorage.getItem("kmr.view")) || "vinyl"
    return (ALL_VIEWS.some((x) => x.value === v) ? v : "vinyl") as ViewName
  })
  const [theme, setTheme] = React.useState<ThemeName>(() => {
    const t = (typeof localStorage !== "undefined" && localStorage.getItem("kmr.theme")) || "classic"
    return (ALL_THEMES.some((x) => x.value === t) ? t : "classic") as ThemeName
  })
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  React.useEffect(() => {
    showControlsRef.current = showControls
  }, [showControls])

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    if (typeof localStorage !== "undefined") localStorage.setItem("kmr.theme", theme)
  }, [theme])

  React.useEffect(() => {
    document.documentElement.setAttribute("data-view", view)
    if (typeof localStorage !== "undefined") localStorage.setItem("kmr.view", view)
  }, [view])

  React.useEffect(() => {
    if (!settingsOpen) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest(".settings-popover") && !target.closest(".settings-trigger")) {
        setSettingsOpen(false)
      }
    }
    window.addEventListener("click", onDocClick)
    return () => window.removeEventListener("click", onDocClick)
  }, [settingsOpen])

  const loadIntoPlayer = React.useCallback((videoId: string, autoplay = true, startSeconds?: number) => {
    const player = playerRef.current
    if (!player) return
    const start = typeof startSeconds === "number" && startSeconds > 0
      ? Math.max(0, Math.floor(startSeconds))
      : undefined
    const arg = start === undefined ? videoId : { videoId, startSeconds: start }

    if (autoplay) {
      player.loadVideoById(arg)
    } else if (player.cueVideoById) {
      player.cueVideoById(arg)
    } else {
      player.loadVideoById(arg)
      window.setTimeout(() => player.pauseVideo(), 0)
    }
    player.setVolume(volumeRef.current)
    setPlaying(autoplay)
  }, [])

  const createPlayer = React.useCallback((
    videoIdToLoad?: string,
    options: { autoplay?: boolean; startSeconds?: number; controls?: boolean } = {},
  ) => {
    const w = window as any
    if (!w.YT?.Player) return

    if (playerRef.current) {
      try { playerRef.current.destroy() } catch {}
      playerReadyRef.current = false
    }

    const container = document.getElementById("yt-player")
    if (!container) return
    container.innerHTML = ""
    const placeholder = document.createElement("div")
    placeholder.id = "yt-player-inner"
    container.appendChild(placeholder)
    const controlsEnabled = options.controls ?? showControlsRef.current

    playerRef.current = new w.YT.Player("yt-player-inner", {
      height: "100%",
      width: "100%",
      playerVars: {
        autoplay: 0,
        controls: controlsEnabled ? 1 : 0,
        modestbranding: 1,
        rel: 0,
        fs: controlsEnabled ? 1 : 0,
        disablekb: 1,
      },
      events: {
        onReady: () => {
          playerReadyRef.current = true
          playerRef.current?.setVolume(volumeRef.current)
          const videoId = videoIdToLoad || pendingVideoIdRef.current
          if (videoId) {
            currentVideoIdRef.current = videoId
            loadIntoPlayer(
              videoId,
              options.autoplay ?? pendingAutoplayRef.current,
              options.startSeconds ?? pendingStartSecondsRef.current,
            )
            pendingVideoIdRef.current = null
            pendingAutoplayRef.current = true
            pendingStartSecondsRef.current = undefined
          }
        },
        onStateChange: (e: { data: number }) => {
          if (e.data === YT_ENDED) {
            playNextRef.current()
          }
        },
      },
    })
  }, [loadIntoPlayer])

  const loadVideo = React.useCallback((videoId: string, autoplay = true, startSeconds?: number, syncPlayback = false) => {
    // Don't restart the same video — prevents prefetch broadcasts from resetting playback.
    if (videoId && videoId === currentVideoIdRef.current && playerReadyRef.current) {
      if (syncPlayback) {
        if (autoplay) playerRef.current?.playVideo()
        else playerRef.current?.pauseVideo()
        setPlaying(autoplay)
      }
      return
    }
    currentVideoIdRef.current = videoId
    if (playerReadyRef.current && playerRef.current) {
      loadIntoPlayer(videoId, autoplay, startSeconds)
    } else {
      pendingVideoIdRef.current = videoId
      pendingAutoplayRef.current = autoplay
      pendingStartSecondsRef.current = startSeconds
    }
  }, [loadIntoPlayer])

  const playNext = React.useCallback(async () => {
    setLoading(true)
    try {
      const data: any = await fetch("/api/radio/next", { method: "POST" }).then((r) => r.json())
      if (data.current) {
        setCurrent(data.current)
        setProgress(0)
        loadVideo(data.current.videoId)
      }
    } catch (err) {
      console.error("playNext failed:", err)
    } finally {
      setLoading(false)
    }
  }, [loadVideo])

  playNextRef.current = playNext

  const fetchMeta = React.useCallback(async () => {
    try {
      const local = await fetch("/api/genres").then((r) => r.json())
      if (Array.isArray(local?.genres) && local.genres.length > 0) setGenres(local.genres)
    } catch {}

    try {
      const all = await fetch("/api/genres/all").then((r) => r.json())
      if (Array.isArray(all?.genres) && all.genres.length > 0) setGenres(all.genres)
    } catch {
      // The local genre endpoint above is enough to keep the UI usable offline.
    }
  }, [])

  const connectWs = React.useCallback(() => {
    const readyState = wsRef.current?.readyState
    if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) return
    shouldReconnectRef.current = true

    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(`${proto}//${location.host}/ws`)

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)

        if (msg.type === "init") {
          if (msg.current) {
            setCurrent(msg.current)
            loadVideo(msg.current.videoId, msg.playing ?? false, msg.current.progress, true)
          }
          setPlaying(msg.playing ?? false)
          setGenre(msg.genre || "")
          if (msg.mode) setMode(msg.mode)
          setAnchor(msg.anchor ?? null)
          if (msg.spread) setSpread(msg.spread)
          if (Array.isArray(msg.decades)) setDecades(msg.decades)
          if (typeof msg.anchorFrequency === "number") setAnchorFrequency(msg.anchorFrequency)
          setQueue((msg.queue || []) as Track[])
          setHistory((msg.history || []) as Track[])
        }

        if (msg.type === "track") {
          if (msg.current) {
            setCurrent(msg.current)
            // Only reset progress + load video when it's actually a NEW track
            if (msg.current.videoId !== currentVideoIdRef.current) {
              setProgress(0)
              loadVideo(msg.current.videoId)
            }
          }
          setQueue((msg.queue || []) as Track[])
          setHistory((msg.history || []) as Track[])
        }

        if (msg.type === "state") {
          setPlaying(msg.playing ?? false)
          setGenre(msg.genre || "")
          if (msg.mode) setMode(msg.mode)
          if ("anchor" in msg) setAnchor(msg.anchor ?? null)
          if (msg.spread) setSpread(msg.spread)
          if (Array.isArray(msg.decades)) setDecades(msg.decades)
          if (typeof msg.anchorFrequency === "number") setAnchorFrequency(msg.anchorFrequency)
        }
      } catch {}
    }

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      setConnected(false)
      if (!shouldReconnectRef.current) return
      reconnectRef.current = setTimeout(connectWs, 3000)
    }

    ws.onerror = () => {
      ws.close()
    }

    wsRef.current = ws
  }, [loadVideo])

  const olderHistory = React.useMemo(() => {
    if (!current) return history
    const idx = history.findIndex((t) => t.videoId === current.videoId)
    return idx >= 0 ? history.slice(idx + 1) : history
  }, [history, current])

  const jumpToTrack = React.useCallback(async (videoId: string) => {
    if (!videoId) return
    setLoading(true)
    try {
      const res = await fetch("/api/radio/jump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data?.current) {
        setCurrent(data.current)
        setProgress(0)
        loadVideo(data.current.videoId)
      }
    } catch (err) {
      console.error("jumpToTrack failed:", err)
    } finally {
      setLoading(false)
    }
  }, [loadVideo])

  const togglePause = React.useCallback(async () => {
    try {
      if (playing) {
        await fetch("/api/radio/pause", { method: "POST" })
        playerRef.current?.pauseVideo()
        setPlaying(false)
      } else {
        await fetch("/api/radio/resume", { method: "POST" })
        playerRef.current?.playVideo()
        setPlaying(true)
      }
    } catch {}
  }, [playing])

  togglePauseRef.current = togglePause

  playPrevRef.current = () => {
    if (olderHistory[0]) void jumpToTrack(olderHistory[0].videoId)
  }

  const changeGenre = React.useCallback(async (g: string) => {
    setGenre(g)
    try {
      await fetch("/api/radio/genre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre: g }),
      })
    } catch {}
  }, [])

  const changeMode = React.useCallback(async (m: Mode) => {
    setMode(m)
    try {
      await fetch("/api/radio/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: m }),
      })
    } catch {}
  }, [])

  const changeSpread = React.useCallback(async (s: Spread) => {
    setSpread(s)
    try {
      await fetch("/api/radio/spread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spread: s }),
      })
    } catch {}
  }, [])

  const toggleDecade = React.useCallback(async (d: Decade) => {
    const next = decades.includes(d) ? decades.filter((x) => x !== d) : [...decades, d]
    setDecades(next)
    try {
      await fetch("/api/radio/decades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decades: next }),
      })
    } catch {}
  }, [decades])

  const lookupAnchor = React.useCallback(async (q: string) => {
    if (!q.trim()) {
      setAnchorCandidates([])
      return
    }
    setAnchorSearching(true)
    try {
      const data = await fetch(`/api/artists/lookup?q=${encodeURIComponent(q)}`).then((r) => r.json())
      setAnchorCandidates((data?.candidates || []) as AnchorCandidate[])
    } catch {
      setAnchorCandidates([])
    } finally {
      setAnchorSearching(false)
    }
  }, [])

  const commitAnchor = React.useCallback(async (candidate: AnchorCandidate | string) => {
    setAnchorError(null)
    const body = typeof candidate === "string"
      ? { name: candidate }
      : { name: candidate.name, source: candidate.source, sourceId: candidate.sourceId }
    try {
      const res = await fetch("/api/radio/anchor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAnchorError(err?.error || "Nicht gefunden")
        return
      }
      const data = await res.json()
      setAnchor(data.anchor)
      setAnchorQuery("")
      setAnchorCandidates([])
    } catch (e: any) {
      setAnchorError(e?.message || "Fehler")
    }
  }, [])

  const clearAnchor = React.useCallback(async () => {
    setAnchorError(null)
    try {
      await fetch("/api/radio/anchor", { method: "DELETE" })
      setAnchor(null)
    } catch {}
  }, [])

  const openMAProfile = React.useCallback(async (artist: string) => {
    if (!artist) return
    try {
      const data = await fetch("/api/artists/search?q=" + encodeURIComponent(artist)).then((r) => r.json())
      const match = (data.artists || []).find((a: any) => a.name.toLowerCase() === artist.toLowerCase())
      if (match?.maId) {
        const slug = artist.replace(/\s+/g, "_")
        window.open(`https://www.metal-archives.com/bands/${slug}/${match.maId}`, "_blank")
      }
    } catch {}
  }, [])

  const changeAnchorFrequency = React.useCallback(async (freq: number) => {
    setAnchorFrequency(freq)
    try {
      await fetch("/api/radio/anchor-frequency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency: freq }),
      })
    } catch {}
  }, [])

  React.useEffect(() => {
    const q = anchorQuery.trim()
    if (!q) {
      setAnchorCandidates([])
      return
    }
    const id = setTimeout(() => { void lookupAnchor(q) }, 350)
    return () => clearTimeout(id)
  }, [anchorQuery, lookupAnchor])

  const [feedbackFlash, setFeedbackFlash] = React.useState<"like" | "dislike" | null>(null)

  const sendFeedback = React.useCallback(async (kind: "like" | "dislike") => {
    if (!current?.artist) return
    setFeedbackFlash(kind)
    setTimeout(() => setFeedbackFlash(null), 800)
    try {
      await fetch(`/api/radio/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artist: current.artist }),
      })
    } catch {}
  }, [current])

  const handleVolume = React.useCallback((v: number) => {
    setVolume(v)
    volumeRef.current = v
    playerRef.current?.setVolume(v)
  }, [])

  const toggleYoutubeControls = React.useCallback(() => {
    const next = !showControls
    const videoId = currentVideoIdRef.current
    const startSeconds = playerRef.current?.getCurrentTime?.() || progress
    const autoplay = playing
    setShowControls(next)
    if (videoId) createPlayer(videoId, { controls: next, startSeconds, autoplay })
  }, [createPlayer, playing, progress, showControls])

  const handleSeek = React.useCallback((clientX: number) => {
    if (!progressBarRef.current || !current?.duration) return
    const rect = progressBarRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const seekTo = pct * current.duration
    playerRef.current?.seekTo(seekTo, true)
    setProgress(seekTo)
  }, [current])

  const handleProgressBarDown = React.useCallback((e: React.MouseEvent | React.TouchEvent) => {
    seekingRef.current = true
    const clientX = "touches" in e ? e.touches[0]!.clientX : (e as React.MouseEvent).clientX
    handleSeek(clientX)
  }, [handleSeek])

  React.useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!seekingRef.current) return
      const clientX = "touches" in e ? e.touches[0]!.clientX : (e as MouseEvent).clientX
      handleSeek(clientX)
    }
    const onUp = () => {
      seekingRef.current = false
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    window.addEventListener("touchmove", onMove)
    window.addEventListener("touchend", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      window.removeEventListener("touchmove", onMove)
      window.removeEventListener("touchend", onUp)
    }
  }, [handleSeek])

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return

      if (e.code === "Space") {
        e.preventDefault()
        togglePauseRef.current()
      } else if (e.code === "ArrowRight") {
        e.preventDefault()
        playNextRef.current()
      } else if (e.code === "ArrowLeft") {
        e.preventDefault()
        playPrevRef.current()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  React.useEffect(() => {
    let mounted = true

    async function init() {
      await loadYTApi()
      if (!mounted) return

      createPlayer()

      connectWs()
      await fetchMeta()
    }

    init()

    return () => {
      mounted = false
      shouldReconnectRef.current = false
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      const ws = wsRef.current
      wsRef.current = null
      ws?.close()
    }
  }, [createPlayer, connectWs, fetchMeta])

  React.useEffect(() => {
    pollRef.current = setInterval(() => {
      if (seekingRef.current) return
      if (playerReadyRef.current && playerRef.current) {
        const p = playerRef.current.getCurrentTime?.() || 0
        setProgress(p)
      }
    }, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const progressPct = current?.duration
    ? Math.min((progress / current.duration) * 100, 100)
    : 0

  return (
    <div className="app">
      <div className="header">
        <h1>KMR <span className="header-sub">Kaufis Metal Radio</span></h1>
        {mode === "band" && anchor ? (
          <span className="genre-badge" title={`Anker: ${anchor.name} (${anchor.source === "ma" ? "Metal-Archives" : "music-map"})`}>
            ⚓ {anchor.name}
          </span>
        ) : mode === "genre" && genre ? (
          <span className="genre-badge">{genre}</span>
        ) : null}
        {!connected && <span className="reconnect-badge">reconnecting...</span>}
        <div className="header-spacer" />
        <button
          className="settings-trigger"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="Einstellungen"
          title="Ansicht und Theme"
        >
          ⚙
        </button>
        {settingsOpen && (
          <div className="settings-popover" role="dialog">
            <div className="popover-section">
              <span className="popover-label">Ansicht</span>
              <div className="popover-buttons">
                {ALL_VIEWS.map((v) => (
                  <button
                    key={v.value}
                    className={view === v.value ? "active" : ""}
                    onClick={() => setView(v.value)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="popover-section">
              <span className="popover-label">Theme</span>
              <div className="popover-themes">
                {ALL_THEMES.map((t) => (
                  <button
                    key={t.value}
                    className={`theme-chip theme-${t.value}${theme === t.value ? " active" : ""}`}
                    onClick={() => setTheme(t.value)}
                    title={t.label}
                  >
                    <span className="theme-swatch" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="hero">
        <div className={`hero-stage ${showVideo ? "stage-video" : "stage-vinyl"}`}>
          <div className="player-frame">
            <div id="yt-player" />
            {!current && !showVideo && (
              <div className="player-placeholder">Drücke Skip zum Starten</div>
            )}
          </div>

          {!showVideo && (
            <div className="vinyl-row">
              <div className="vinyl-rail vinyl-rail-history">
                {olderHistory.slice(0, 6).map((t, i) => (
                  <VinylDisc
                    key={`h-${t.videoId}-${i}`}
                    track={t}
                    size="small"
                    position="history"
                    distance={i}
                    onClick={() => jumpToTrack(t.videoId)}
                  />
                ))}
              </div>
              <VinylDisc
                track={current}
                size="large"
                position="center"
                spinning={playing}
                onClick={current ? togglePause : undefined}
              />
              <div className="vinyl-rail vinyl-rail-queue">
                {queue.slice(0, 6).map((t, i) => (
                  <VinylDisc
                    key={`q-${t.videoId}-${i}`}
                    track={t}
                    size="small"
                    position="queue"
                    distance={i}
                    onClick={() => jumpToTrack(t.videoId)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="hero-meta">
          <div className="track-title">{current?.title || "—"}</div>
          <div
            className="track-artist clickable"
            onClick={() => openMAProfile(current?.artist || "")}
            title="Auf Metal-Archives öffnen"
          >
            {current?.artist || ""}
          </div>
          {current && (
            <div className="track-meta">
              {current.genre && <span>{current.genre}</span>}
              {current.similarTo && <span>≈ {current.similarTo}</span>}
              {typeof current.hopsFromAnchor === "number" && (
                <span title="Hops vom Anker">⤳ {current.hopsFromAnchor}</span>
              )}
            </div>
          )}
        </div>

        {current && (
          <div className="progress-wrap">
            <div
              ref={progressBarRef}
              className="progress-bar"
              onMouseDown={handleProgressBarDown}
              onTouchStart={handleProgressBarDown}
            >
              <div className="fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="progress-text">
              {formatTime(progress)} / {formatTime(current.duration)}
            </div>
          </div>
        )}

        <div className="controls">
          <button
            onClick={() => olderHistory[0] && jumpToTrack(olderHistory[0].videoId)}
            disabled={olderHistory.length === 0}
            title="Zurück"
            aria-label="Vorheriger Track"
          >
            ⏮
          </button>
          <button className="btn-play" onClick={togglePause} disabled={!current} title={playing ? "Pause (Space)" : "Play (Space)"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button onClick={playNext} disabled={loading} title="Skip (→)">
            {loading ? "…" : "⏭"}
          </button>
          <button
            className={`btn-feedback${feedbackFlash === "like" ? " flash" : ""}`}
            onClick={() => sendFeedback("like")}
            disabled={!current}
            title="Like"
            aria-label="Like"
          >
            ♥
          </button>
          <button
            className={`btn-feedback${feedbackFlash === "dislike" ? " flash" : ""}`}
            onClick={() => sendFeedback("dislike")}
            disabled={!current}
            title="Dislike"
            aria-label="Dislike"
          >
            ✕
          </button>
          <button
            className="btn-secondary"
            onClick={() => setShowVideo((v) => !v)}
            title={showVideo ? "Vinyl-Ansicht" : "Video-Ansicht"}
          >
            {showVideo ? "Vinyl" : "Video"}
          </button>
          {showVideo && (
            <button
              className="btn-secondary"
              onClick={toggleYoutubeControls}
              title="YouTube-Controls"
            >
              YT {showControls ? "on" : "off"}
            </button>
          )}
          <div className="volume-wrap">
            <span aria-hidden>🔊</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => handleVolume(Number((e.target as HTMLInputElement).value))}
            />
          </div>
        </div>
      </div>

      <div className="mode-section">
        <div className="mode-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "band"}
            className={mode === "band" ? "active" : ""}
            onClick={() => changeMode("band")}
          >
            Künstler
          </button>
          <button
            role="tab"
            aria-selected={mode === "genre"}
            className={mode === "genre" ? "active" : ""}
            onClick={() => changeMode("genre")}
          >
            Genre
          </button>
        </div>

        {mode === "band" ? (
          <div className="mode-band">
            {anchor ? (
              <div className="anchor-badge">
                <span className="anchor-label">Anker</span>
                <span className="anchor-name">{anchor.name}</span>
                <span className="anchor-source">{anchor.source === "ma" ? "MA" : "music-map"}</span>
                <button className="btn-secondary btn-sm" onClick={clearAnchor}>
                  Ändern
                </button>
              </div>
            ) : (
              <div className="anchor-picker">
                <input
                  type="text"
                  className="anchor-input"
                  placeholder="Künstler suchen..."
                  value={anchorQuery}
                  onChange={(e) => setAnchorQuery((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      if (anchorQuery.trim()) void commitAnchor(anchorQuery.trim())
                    }
                  }}
                />
                {anchorSearching && <span className="anchor-status">…</span>}
                {anchorError && <span className="anchor-error">{anchorError}</span>}
                {anchorCandidates.length > 0 && (
                  <ul className="anchor-candidates">
                    {anchorCandidates.map((c, i) => (
                      <li key={`${c.source}-${c.sourceId}-${i}`}>
                        <button onClick={() => commitAnchor(c)}>
                          <span className="candidate-name">{c.name}</span>
                          <span className="candidate-hint">{c.hint}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mode-row anchor-frequency-wrap">
              <span className="mode-row-label">Anchor-Freq.</span>
              <input
                type="range"
                min={0}
                max={100}
                value={anchorFrequency}
                onChange={(e) => changeAnchorFrequency(Number((e.target as HTMLInputElement).value))}
              />
              <span className="frequency-label">{anchorFrequency}%</span>
            </div>
          </div>
        ) : (
          <div className="mode-genre">
            <label className="mode-row">
              <span className="mode-row-label">Genre</span>
              <select value={genre} onChange={(e) => changeGenre((e.target as HTMLSelectElement).value)}>
                {genres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <div className="mode-row">
              <span className="mode-row-label">Dekaden</span>
              <div className="decade-chips">
                {ALL_DECADES.map((d) => (
                  <button
                    key={d}
                    className={`decade-chip${decades.includes(d) ? " active" : ""}`}
                    onClick={() => toggleDecade(d)}
                    aria-pressed={decades.includes(d)}
                  >
                    {DECADE_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mode-row">
          <span className="mode-row-label">Ähnlichkeit</span>
          <div className="spread-slider" role="radiogroup">
            {(["narrow", "medium", "wide"] as Spread[]).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={spread === s}
                className={`spread-step${spread === s ? " active" : ""}`}
                onClick={() => changeSpread(s)}
              >
                {SPREAD_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </div>


      <div className="kbd-hint">
        <kbd>←</kbd> Zurück &nbsp; <kbd>Space</kbd> Play/Pause &nbsp; <kbd>→</kbd> Skip
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById("root")!)
root.render(<App />)
