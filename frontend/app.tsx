import React from "react"
import { createRoot } from "react-dom/client"
import "./app.css"

interface Track {
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
  progress?: number
}

interface LyricLine { startMs: number; text: string }
interface LyricsData {
  videoId: string
  kind: "synced" | "plain" | "missing"
  source: "LRCLIB"
  lines: LyricLine[]
  text: string
}
interface ArtistFocus { maId: number; name: string }

interface MAMember { name: string; role: string; kind: "current" | "past" | "live" }
interface MARelease {
  maId: number; albumId: number; title: string; type: string; year: string
  coverUrl?: string; releaseDate?: string; label?: string; catalogId?: string; format?: string
  rating?: number; reviewCount?: number
}
interface MABand {
  maId: number; name: string; genre: string; country: string; location: string; formedIn: string | null
  status: string; yearsActive: string; themes: string; label: string; logoUrl: string; photoUrl: string; members: MAMember[]
}
interface MASimilar { maId: number; name: string; genre: string; country: string; score: number }
interface MASearch { maId: number; name: string; genre: string; country: string; formedIn: string | null }
interface MAProfile { artist: MABand; releases: MARelease[]; similar: MASimilar[] }
interface MAAlbum { release: MARelease; tracks: Array<{ title: string; duration: number }> }
type Language = "de" | "en"
const tr = (language: Language, de: string, en: string) => language === "de" ? de : en

function MARating({ rating, reviewCount = 0, language = "de" }: { rating?: number; reviewCount?: number; language?: Language }) {
  if (typeof rating !== "number") return null
  const label = reviewCount > 0 ? tr(language, `${rating} Prozent aus ${reviewCount} Reviews`, `${rating} percent from ${reviewCount} reviews`) : tr(language, "Noch keine Reviews", "No reviews yet")
  return (
    <span className={`ma-rating${reviewCount === 0 ? " unrated" : ""}`} title={`Metal Archives: ${label}`} aria-label={`${tr(language, "Metal-Archives-Bewertung", "Metal Archives rating")}: ${label}`}>
      <span className="ma-stars" aria-hidden="true">
        <span>★★★★★</span><span className="ma-stars-fill" style={{ width: `${rating}%` }}>★★★★★</span>
      </span>
      <em>{reviewCount > 0 ? `${rating}%` : "—"}</em>
    </span>
  )
}

type Mode = "band" | "genre"
type Spread = "narrow" | "medium" | "wide"
type Decade = "70s" | "80s" | "90s" | "00s" | "10s" | "20s"
type ReleaseTypeFilter = "studio" | "ep" | "live" | "demo" | "single" | "other"

interface Anchor {
  source: "ma"
  sourceId: string
  name: string
}

interface AnchorCandidate {
  source: "ma"
  sourceId: string
  name: string
  hint: string
  genre: string
  country: string
  formedIn: string | null
}

type ViewName = "vinyl" | "cards" | "compact"
type StageMode = "vinyl" | "video" | "lyrics"
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
const ALL_RELEASE_TYPES: ReleaseTypeFilter[] = ["studio", "ep", "live", "demo", "single", "other"]
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

function maImage(url?: string): string | undefined {
  return url ? `/api/ma/artwork?url=${encodeURIComponent(url)}` : undefined
}

function normalizedVolume(volume: number, loudnessDb: number | null, enabled: boolean): number {
  if (!enabled || loudnessDb === null) return volume
  return Math.max(0, Math.min(100, Math.round(volume * Math.pow(10, -loudnessDb / 20))))
}

function LyricsStage({ lyrics, loading, progress, offsetMs, language, onOffset, onSeek }: {
  lyrics: LyricsData | null
  loading: boolean
  progress: number
  offsetMs: number
  language: Language
  onOffset: (offsetMs: number) => void
  onSeek: (seconds: number) => void
}) {
  const active = React.useMemo(() => {
    if (!lyrics || lyrics.kind !== "synced") return -1
    let index = -1
    const progressMs = progress * 1000 - offsetMs
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (lyrics.lines[i]!.startMs > progressMs) break
      index = i
    }
    return index
  }, [lyrics, progress, offsetMs])
  const activeRef = React.useRef<HTMLButtonElement | null>(null)
  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [active])

  if (loading) return <div className="lyrics-empty">{tr(language, "Songtext wird gesucht …", "Searching for lyrics …")}</div>
  if (!lyrics || lyrics.kind === "missing") {
    return <div className="lyrics-empty"><strong>{tr(language, "Kein Songtext gefunden", "No lyrics found")}</strong><span>{tr(language, "Der Titel läuft natürlich trotzdem weiter.", "The song will keep playing.")}</span></div>
  }
  if (lyrics.kind === "plain") {
    return <div className="lyrics-stage"><div className="lyrics-plain">{lyrics.text}</div><span className="lyrics-source">{tr(language, "Quelle: LRCLIB · nicht synchronisiert", "Source: LRCLIB · not synced")}</span></div>
  }
  return (
    <div className="lyrics-stage" aria-live="polite">
      <div className="lyrics-rail">
        {lyrics.lines.map((line, index) => (
          <button
            key={`${line.startMs}-${index}`}
            ref={index === active ? activeRef : null}
            className={`lyric-line${index === active ? " active" : ""}${index < active ? " past" : ""}`}
            onClick={() => onSeek((line.startMs + offsetMs) / 1000)}
          >
            {line.text}
          </button>
        ))}
      </div>
      <div className="lyrics-offset" aria-label={tr(language, "Songtext zeitlich verschieben", "Adjust lyric timing")}>
        <button onClick={() => onOffset(offsetMs - 500)} title={tr(language, "Text früher anzeigen", "Show lyrics earlier")}>−</button>
        <button onClick={() => onOffset(0)} title={tr(language, "Versatz zurücksetzen", "Reset offset")}>{offsetMs === 0 ? "0.0 s" : `${offsetMs > 0 ? "+" : ""}${(offsetMs / 1000).toFixed(1)} s`}</button>
        <button onClick={() => onOffset(offsetMs + 500)} title={tr(language, "Text später anzeigen", "Show lyrics later")}>+</button>
      </div>
      <span className="lyrics-source">{tr(language, "Quelle: LRCLIB", "Source: LRCLIB")}</span>
    </div>
  )
}

function MABrowser({ initialMaId, initialAlbumId, currentMaId, focusMaId, language, onClose, onFocus }: {
  initialMaId: number | null
  initialAlbumId: number | null
  currentMaId?: number
  focusMaId?: number
  language: Language
  onClose: () => void
  onFocus: () => void
}) {
  const tx = (de: string, en: string) => tr(language, de, en)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<MASearch[]>([])
  const [profile, setProfile] = React.useState<MAProfile | null>(null)
  const [albums, setAlbums] = React.useState<Record<number, MAAlbum>>({})
  const [tab, setTab] = React.useState<"overview" | "albums" | "similar">("overview")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")

  const loadArtist = React.useCallback(async (maId: number) => {
    setLoading(true); setError(""); setAlbums({})
    try {
      const response = await fetch(`/api/ma/artists/${maId}`)
      if (!response.ok) throw new Error(tx("Bandinformationen sind gerade nicht erreichbar.", "Band information is currently unavailable."))
      setProfile(await response.json())
      setResults([])
      setTab("overview")
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("Bandinformationen sind gerade nicht erreichbar.", "Band information is currently unavailable."))
    } finally { setLoading(false) }
  }, [language])

  React.useEffect(() => { if (initialMaId) void loadArtist(initialMaId) }, [initialMaId, loadArtist])

  const search = React.useCallback(async () => {
    const q = query.trim()
    if (q.length < 2) return
    setLoading(true); setError(""); setProfile(null)
    try {
      const data = await fetch(`/api/ma/search?q=${encodeURIComponent(q)}`).then((response) => response.json())
      setResults(data.artists || [])
      if (!data.artists?.length) setError(tx("Keine passende Band gefunden.", "No matching band found."))
    } catch { setError(tx("Die Suche ist gerade nicht erreichbar.", "Search is currently unavailable.")) }
    finally { setLoading(false) }
  }, [query, language])

  const loadAlbum = React.useCallback(async (release: MARelease) => {
    if (albums[release.albumId]) {
      setAlbums((current) => { const next = { ...current }; delete next[release.albumId]; return next })
      return
    }
    const response = await fetch(`/api/ma/artists/${release.maId}/releases/${release.albumId}`)
    if (response.ok) {
      const detail = await response.json() as MAAlbum
      setAlbums((current) => ({ ...current, [release.albumId]: detail }))
    }
  }, [albums])

  React.useEffect(() => {
    if (!initialAlbumId || !profile) return
    const release = profile.releases.find((item) => item.albumId === initialAlbumId)
    if (release && !albums[initialAlbumId]) { setTab("albums"); void loadAlbum(release) }
  }, [initialAlbumId, profile, albums, loadAlbum])

  const artist = profile?.artist
  return (
    <div className="ma-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="ma-browser" role="dialog" aria-modal="true" aria-label="Metal Archives Browser">
        <header className="ma-browser-head">
          <div><span className="ma-kicker">Metal Archives</span><h2>{artist?.name || tx("Bandarchiv", "Band archive")}</h2></div>
          <button className="ma-close" onClick={onClose} aria-label={tx("Browser schließen", "Close browser")}>×</button>
        </header>
        <form className="ma-search" onSubmit={(event) => { event.preventDefault(); void search() }}>
          <input value={query} onChange={(event) => setQuery((event.target as HTMLInputElement).value)} placeholder={tx("Band suchen …", "Search bands …")} autoFocus={!initialMaId} />
          <button type="submit">{tx("Suchen", "Search")}</button>
        </form>
        {loading && <div className="ma-message">{tx("Archiv wird geöffnet …", "Opening archive …")}</div>}
        {error && <div className="ma-message error">{error}</div>}
        {results.length > 0 && <div className="ma-results">{results.map((result) => (
          <button key={result.maId} onClick={() => void loadArtist(result.maId)}>
            <strong>{result.name}</strong><span>{[result.genre, result.country, result.formedIn].filter(Boolean).join(" · ")}</span>
          </button>
        ))}</div>}
        {artist && profile && (
          <div className="ma-profile">
            <div className="ma-identity">
              <div className="ma-photo">{artist.photoUrl ? <img src={maImage(artist.photoUrl)} alt={artist.name} /> : <span>MA</span>}</div>
              <div className="ma-identity-copy">
                {artist.logoUrl && <img className="ma-logo" src={maImage(artist.logoUrl)} alt={`${artist.name} Logo`} />}
                <p>{artist.genre}</p><p>{[artist.country, artist.location].filter(Boolean).join(" · ")}</p>
                <div className="ma-actions">
                  {currentMaId === artist.maId && (
                    <button className="focus-action" onClick={onFocus}>
                      {focusMaId === artist.maId ? tx("Wieder alle Artists", "Play all artists") : `${tx("Nur", "Only")} ${artist.name}`}
                    </button>
                  )}
                  <a href={`https://www.metal-archives.com/bands/_/${artist.maId}`} target="_blank" rel="noreferrer">{tx("Originalseite", "Original page")} ↗</a>
                </div>
              </div>
            </div>
            <nav className="ma-tabs">
              <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{tx("Übersicht", "Overview")}</button>
              <button className={tab === "albums" ? "active" : ""} onClick={() => setTab("albums")}>{tx("Diskografie", "Discography")}</button>
              <button className={tab === "similar" ? "active" : ""} onClick={() => setTab("similar")}>{tx("Ähnliche Bands", "Similar bands")}</button>
            </nav>
            {tab === "overview" && <div className="ma-overview">
              <dl>
                <div><dt>Status</dt><dd>{artist.status || "—"}</dd></div>
                <div><dt>{tx("Gegründet", "Formed")}</dt><dd>{artist.formedIn || "—"}</dd></div>
                <div><dt>{tx("Aktiv", "Years active")}</dt><dd>{artist.yearsActive || "—"}</dd></div>
                <div><dt>Label</dt><dd>{artist.label || "—"}</dd></div>
                <div className="wide"><dt>{tx("Themen", "Themes")}</dt><dd>{artist.themes || "—"}</dd></div>
              </dl>
              <div className="ma-members"><h3>{tx("Mitglieder", "Members")}</h3>{(["current", "live", "past"] as const).map((kind) => {
                const members = artist.members.filter((member) => member.kind === kind)
                return members.length ? <div key={kind}><h4>{{ current: tx("Aktuell", "Current"), live: "Live", past: tx("Ehemalig", "Past") }[kind]}</h4>{members.map((member, index) => <p key={`${member.name}-${index}`}><strong>{member.name}</strong><span>{member.role}</span></p>)}</div> : null
              })}</div>
            </div>}
            {tab === "albums" && <div className="ma-discography">{profile.releases.map((release) => {
              const detail = albums[release.albumId]
              const shown = detail?.release || release
              return <article key={release.albumId} className="ma-release">
                <button className="ma-release-head" onClick={() => void loadAlbum(release)}>
                  <div className="ma-cover">{shown.coverUrl ? <img src={maImage(shown.coverUrl)} alt="" /> : <span>{release.year}</span>}</div>
                  <div><strong>{release.title}</strong><span>{release.type} · {release.year}</span><MARating rating={shown.rating} reviewCount={shown.reviewCount} language={language} /></div><b>{detail ? "−" : "+"}</b>
                </button>
                {detail && <div className="ma-tracklist">
                  <p>{[shown.releaseDate, shown.label, shown.format, shown.catalogId].filter(Boolean).join(" · ")}</p>
                  <a className="ma-review-link" href={`https://www.metal-archives.com/reviews/${encodeURIComponent(artist.name.replaceAll(" ", "_"))}/${encodeURIComponent(release.title.replaceAll(" ", "_"))}/${release.albumId}/`} target="_blank" rel="noreferrer">{tx("Reviews bei Metal Archives", "Reviews on Metal Archives")} ↗</a>
                  <ol>{detail.tracks.map((track, index) => <li key={`${track.title}-${index}`}><span>{track.title}</span><time>{formatTime(track.duration)}</time></li>)}</ol>
                </div>}
              </article>
            })}</div>}
            {tab === "similar" && <div className="ma-similar">{profile.similar.map((similar) => <button key={similar.maId} onClick={() => void loadArtist(similar.maId)}><strong>{similar.name}</strong><span>{similar.genre} · {similar.country}</span><b>{similar.score}%</b></button>)}</div>}
          </div>
        )}
      </section>
    </div>
  )
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
  const nextRetryRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnectRef = React.useRef(true)
  const progressBarRef = React.useRef<HTMLDivElement | null>(null)
  const seekingRef = React.useRef(false)
  const showControlsRef = React.useRef(false)
  const outputVolumeRef = React.useRef(80)
  const languageRef = React.useRef<Language>("de")

  const [current, setCurrent] = React.useState<Track | null>(null)
  const [progress, setProgress] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [volume, setVolume] = React.useState(80)
  const [genre, setGenre] = React.useState("")
  const [genres, setGenres] = React.useState<string[]>([])
  const [countries, setCountries] = React.useState<string[]>([])
  const [country, setCountry] = React.useState("")
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
  const [stageMode, setStageMode] = React.useState<StageMode>("vinyl")
  const [lyrics, setLyrics] = React.useState<LyricsData | null>(null)
  const [lyricsLoading, setLyricsLoading] = React.useState(false)
  const [lyricsOffset, setLyricsOffset] = React.useState(0)
  const [currentRelease, setCurrentRelease] = React.useState<MARelease | null>(null)
  const [artistFocus, setArtistFocus] = React.useState<ArtistFocus | null>(null)
  const [maBrowserOpen, setMaBrowserOpen] = React.useState(false)
  const [maBrowserArtist, setMaBrowserArtist] = React.useState<number | null>(null)
  const [maBrowserAlbum, setMaBrowserAlbum] = React.useState<number | null>(null)
  const [queueLoading, setQueueLoading] = React.useState(false)
  const [queueMessage, setQueueMessage] = React.useState("")
  const [releaseTypes, setReleaseTypes] = React.useState<ReleaseTypeFilter[]>([...ALL_RELEASE_TYPES])
  const [loudnessDb, setLoudnessDb] = React.useState<number | null>(null)
  const [normalization, setNormalization] = React.useState(() => localStorage.getItem("kmr.normalization") !== "off")
  const [language, setLanguage] = React.useState<Language>(() => localStorage.getItem("kmr.language") === "en" ? "en" : "de")
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
  const showVideo = stageMode === "video"
  const showLyrics = stageMode === "lyrics"
  const tx = (de: string, en: string) => tr(language, de, en)

  React.useEffect(() => {
    languageRef.current = language
    localStorage.setItem("kmr.language", language)
    document.documentElement.lang = language
  }, [language])

  React.useEffect(() => {
    const offsets = JSON.parse(localStorage.getItem("kmr.lyricsOffsets") || "{}") as Record<string, number>
    setLyricsOffset(current?.videoId ? Number(offsets[current.videoId] || 0) : 0)
  }, [current?.videoId])

  React.useEffect(() => {
    if (!current?.videoId) { setLoudnessDb(null); return }
    const videoId = current.videoId
    setLoudnessDb(null)
    void fetch("/api/radio/loudness")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.videoId === videoId && typeof data.loudnessDb === "number") setLoudnessDb(data.loudnessDb) })
      .catch(() => {})
  }, [current?.videoId])

  React.useEffect(() => {
    const output = normalizedVolume(volume, loudnessDb, normalization)
    outputVolumeRef.current = output
    playerRef.current?.setVolume(output)
    localStorage.setItem("kmr.normalization", normalization ? "on" : "off")
  }, [volume, loudnessDb, normalization])

  React.useEffect(() => {
    const maId = current?.maId
    const albumId = current?.albumId
    if (!maId || !albumId) { setCurrentRelease(null); return }
    const controller = new AbortController()
    setCurrentRelease(null)
    void fetch(`/api/ma/artists/${maId}/releases/${albumId}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.release) setCurrentRelease(data.release) })
      .catch(() => {})
    return () => controller.abort()
  }, [current?.maId, current?.albumId])

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
    player.setVolume(outputVolumeRef.current)
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
          playerRef.current?.setVolume(outputVolumeRef.current)
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
    if (nextRetryRef.current) { clearTimeout(nextRetryRef.current); nextRetryRef.current = null }
    setLoading(true)
    setQueueLoading(true)
    setQueueMessage(tx("Nächste Platte wird gesucht …", "Searching for the next record …"))
    try {
      const response = await fetch("/api/radio/next", { method: "POST" })
      const data: any = await response.json().catch(() => ({}))
      if (data.current) {
        setCurrent(data.current)
        setProgress(0)
        loadVideo(data.current.videoId)
        setQueueMessage("")
      } else if (!response.ok) {
        setQueueMessage(tx("Noch kein passender Titel gefunden. Neuer Versuch läuft …", "No matching track found yet. Trying again …"))
        nextRetryRef.current = setTimeout(() => playNextRef.current(), 8000)
      }
    } catch (err) {
      console.error("playNext failed:", err)
      setQueueMessage(tx("Verbindung unterbrochen. Neuer Versuch läuft …", "Connection interrupted. Trying again …"))
      nextRetryRef.current = setTimeout(() => playNextRef.current(), 8000)
    } finally {
      setLoading(false)
    }
  }, [loadVideo, language])

  playNextRef.current = playNext

  const fetchMeta = React.useCallback(async () => {
    try {
      const local = await fetch("/api/genres").then((r) => r.json())
      if (Array.isArray(local?.genres) && local.genres.length > 0) setGenres(local.genres)
    } catch {}

    try {
      const data = await fetch("/api/countries").then((response) => response.json())
      if (Array.isArray(data?.countries)) setCountries(data.countries)
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
          setArtistFocus(msg.artistFocus ?? null)
          if (Array.isArray(msg.releaseTypes)) setReleaseTypes(msg.releaseTypes)
          if (typeof msg.country === "string") setCountry(msg.country)
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
          if ("artistFocus" in msg) setArtistFocus(msg.artistFocus ?? null)
          if (Array.isArray(msg.releaseTypes)) setReleaseTypes(msg.releaseTypes)
          if (typeof msg.country === "string") setCountry(msg.country)
        }

        if (msg.type === "queue-status") {
          setQueueLoading(!!msg.loading)
          setQueueMessage(msg.loading
            ? tr(languageRef.current, "Nächste Platte wird gesucht …", "Searching for the next record …")
            : msg.queueSize > 0 ? "" : tr(languageRef.current, "Für diese Auswahl wurde noch kein weiterer Titel gefunden.", "No additional track has been found for this selection."))
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
    const older = idx >= 0 ? history.slice(idx + 1) : history
    return older.filter((track) => track.maId > 0)
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

  const changeCountry = React.useCallback(async (next: string) => {
    setCountry(next)
    await fetch("/api/radio/country", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country: next }),
    }).catch(() => {})
  }, [])

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
        if (Array.isArray(err?.candidates)) setAnchorCandidates(err.candidates)
        setAnchorError(err?.error || tx("Nicht gefunden", "Not found"))
        return
      }
      const data = await res.json()
      setAnchor(data.anchor)
      setAnchorQuery("")
      setAnchorCandidates([])
    } catch (e: any) {
      setAnchorError(e?.message || tx("Fehler", "Error"))
    }
  }, [language])

  const clearAnchor = React.useCallback(async () => {
    setAnchorError(null)
    try {
      await fetch("/api/radio/anchor", { method: "DELETE" })
      setAnchor(null)
    } catch {}
  }, [])

  const openMABrowser = React.useCallback((maId?: number, albumId?: number) => {
    setMaBrowserArtist(maId && maId > 0 ? maId : null)
    setMaBrowserAlbum(albumId && albumId > 0 ? albumId : null)
    setMaBrowserOpen(true)
  }, [])

  const toggleArtistFocus = React.useCallback(async () => {
    if (artistFocus) {
      const response = await fetch("/api/radio/artist-focus", { method: "DELETE" })
      if (response.ok) setArtistFocus(null)
      return
    }
    if (!current) return
    const response = await fetch("/api/radio/artist-focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maId: current.maId, videoId: current.videoId }),
    })
    const data = await response.json().catch(() => ({}))
    if (response.ok) setArtistFocus(data.artistFocus)
  }, [artistFocus, current])

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

  React.useEffect(() => {
    if (!showLyrics || !current) return
    let active = true
    setLyricsLoading(true)
    setLyrics(null)
    fetch("/api/radio/lyrics")
      .then(async (response) => response.ok ? await response.json() as LyricsData : null)
      .then((data) => {
        if (active && data?.videoId === current.videoId) setLyrics(data)
      })
      .catch(() => { if (active) setLyrics(null) })
      .finally(() => { if (active) setLyricsLoading(false) })
    return () => { active = false }
  }, [showLyrics, current?.videoId])

  const [feedbackFlash, setFeedbackFlash] = React.useState<"like" | "dislike" | null>(null)

  const sendFeedback = React.useCallback(async (kind: "like" | "dislike") => {
    if (!current?.artist) return
    setFeedbackFlash(kind)
    setTimeout(() => setFeedbackFlash(null), 800)
    try {
      await fetch(`/api/radio/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artist: current.artist, maId: current.maId }),
      })
    } catch {}
  }, [current])

  const blockCurrentTrack = React.useCallback(async () => {
    if (!current) return
    setLoading(true)
    setQueueLoading(true)
    setQueueMessage(tx("Titel wird gesperrt, nächste Platte wird gesucht …", "Blocking track and searching for the next record …"))
    try {
      const response = await fetch("/api/radio/block-track", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId: current.videoId }),
      })
      const data = await response.json().catch(() => ({}))
      if (data.current) { setCurrent(data.current); setProgress(0); loadVideo(data.current.videoId); setQueueMessage("") }
      else setQueueMessage(tx("Titel gesperrt. Ein neuer Titel wird gesucht …", "Track blocked. Searching for a new track …"))
    } finally { setLoading(false) }
  }, [current, loadVideo, language])

  const changeLyricsOffset = React.useCallback((offsetMs: number) => {
    const bounded = Math.max(-10_000, Math.min(10_000, offsetMs))
    setLyricsOffset(bounded)
    if (!current?.videoId) return
    const offsets = JSON.parse(localStorage.getItem("kmr.lyricsOffsets") || "{}") as Record<string, number>
    if (bounded === 0) delete offsets[current.videoId]
    else offsets[current.videoId] = bounded
    localStorage.setItem("kmr.lyricsOffsets", JSON.stringify(offsets))
  }, [current?.videoId])

  const toggleReleaseType = React.useCallback(async (type: ReleaseTypeFilter) => {
    const next = releaseTypes.includes(type) ? releaseTypes.filter((item) => item !== type) : [...releaseTypes, type]
    if (next.length === 0) return
    setReleaseTypes(next)
    await fetch("/api/radio/release-types", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ releaseTypes: next }),
    }).catch(() => {})
  }, [releaseTypes])

  const handleVolume = React.useCallback((v: number) => {
    setVolume(v)
    volumeRef.current = v
    const output = normalizedVolume(v, loudnessDb, normalization)
    outputVolumeRef.current = output
    playerRef.current?.setVolume(output)
  }, [loudnessDb, normalization])

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

  const seekToSeconds = React.useCallback((seconds: number) => {
    const target = Math.max(0, Math.min(current?.duration || seconds, seconds))
    playerRef.current?.seekTo(target, true)
    setProgress(target)
  }, [current?.duration])

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
      if (nextRetryRef.current) clearTimeout(nextRetryRef.current)
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
    }, showLyrics ? 250 : 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [showLyrics])

  const progressPct = current?.duration
    ? Math.min((progress / current.duration) * 100, 100)
    : 0

  return (
    <div className={`app${showVideo || showLyrics ? " app-video" : ""}`}>
      <div className="header">
        <h1>KMR <span className="header-sub">Kaufis Metal Radio</span></h1>
        {mode === "band" && anchor ? (
          <span className="genre-badge" title={`${tx("Startband", "Starting band")}: ${anchor.name} (Metal Archives)`}>
            ⚓ {anchor.name}
          </span>
        ) : mode === "genre" && genre ? (
          <span className="genre-badge">{genre}</span>
        ) : null}
        {!connected && <span className="reconnect-badge">{tx("verbinde neu …", "reconnecting …")}</span>}
        <div className="header-spacer" />
        <div className="language-switch" aria-label={tx("Sprache", "Language")}>
          <button className={language === "de" ? "active" : ""} onClick={() => setLanguage("de")} title="Deutsch" aria-pressed={language === "de"}>🇩🇪</button>
          <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")} title="English" aria-pressed={language === "en"}>🇬🇧</button>
        </div>
        <button className="ma-trigger" onClick={() => openMABrowser(current?.maId)} title={tx("Metal Archives durchsuchen", "Browse Metal Archives")}>{tx("MA Archiv", "MA Archive")}</button>
        <button
          className="settings-trigger"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label={tx("Einstellungen", "Settings")}
          title={tx("Ansicht und Theme", "View and theme")}
        >
          ⚙
        </button>
        {settingsOpen && (
          <div className="settings-popover" role="dialog">
            <div className="popover-section">
              <span className="popover-label">{tx("Ansicht", "View")}</span>
              <div className="popover-buttons">
                {ALL_VIEWS.map((v) => (
                  <button
                    key={v.value}
                    className={view === v.value ? "active" : ""}
                    onClick={() => setView(v.value)}
                  >
                    {{ vinyl: "Vinyl", cards: tx("Karten", "Cards"), compact: tx("Kompakt", "Compact") }[v.value]}
                  </button>
                ))}
              </div>
            </div>
            <div className="popover-section">
              <span className="popover-label">{tx("Theme", "Theme")}</span>
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
        <div className={`hero-stage stage-${stageMode}`}>
          <div className="player-frame">
            <div id="yt-player" />
            {!current && stageMode === "vinyl" && (
              <div className="player-placeholder">{tx("Drücke Skip zum Starten", "Press skip to start")}</div>
            )}
          </div>

          {stageMode === "vinyl" && (
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
                {queue.length === 0 && (
                  <div className={`queue-loader${queueLoading ? " active" : ""}`} role="status">
                    <span className="queue-loader-disc" aria-hidden="true" />
                    <small>{queueMessage || tx("Queue wird vorbereitet …", "Preparing queue …")}</small>
                  </div>
                )}
              </div>
            </div>
          )}
          {showLyrics && <LyricsStage lyrics={lyrics} loading={lyricsLoading} progress={progress} offsetMs={lyricsOffset} language={language} onOffset={changeLyricsOffset} onSeek={seekToSeconds} />}
        </div>

        <div className="hero-meta">
          <div className="track-title">{current?.title || "—"}</div>
          <div
            className="track-artist clickable"
            onClick={() => openMABrowser(current?.maId)}
            title={tx("Im Metal-Archives-Browser öffnen", "Open in Metal Archives browser")}
          >
            {current?.artist || ""}
          </div>
          {current?.album && (
            <button className="album-credit" onClick={() => openMABrowser(current.maId, current.albumId)} title={tx("Album und Reviews bei Metal Archives öffnen", "Open album and reviews on Metal Archives")}>
              <span>{current.album}</span>
              {currentRelease?.year && <time>{currentRelease.year}</time>}
              <MARating rating={currentRelease?.rating} reviewCount={currentRelease?.reviewCount} language={language} />
            </button>
          )}
          {current && (
            <div className="track-meta">
              {current.genre && <span>{current.genre}</span>}
              {current.similarTo && <span>≈ {current.similarTo}</span>}
              {typeof current.hopsFromAnchor === "number" && (
                <span title={tx("Schritte von der Startband", "Steps from the starting band")}>⤳ {current.hopsFromAnchor}</span>
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
            title={tx("Zurück", "Previous")}
            aria-label={tx("Vorheriger Track", "Previous track")}
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
          <button className="btn-secondary" onClick={() => void blockCurrentTrack()} disabled={!current || loading} title={tx("Diesen Song nie wieder spielen", "Never play this song again")} aria-label={tx("Diesen Song nie wieder spielen", "Never play this song again")}>⊘</button>
          <button
            className={`btn-focus${artistFocus ? " active" : ""}`}
            onClick={() => void toggleArtistFocus()}
            disabled={!current}
            title={artistFocus ? tx("Wieder alle passenden Artists spielen", "Play all matching artists again") : `${tx("Nur", "Only")} ${current?.artist || tx("diesen Artist", "this artist")} ${tx("spielen", "")}`}
          >
            {artistFocus ? tx("Alle Artists", "All artists") : `${tx("Nur", "Only")} ${current?.artist || "Artist"}`}
          </button>
          <div className="stage-switch" aria-label={tx("Player-Ansicht", "Player view")}>
            {(["vinyl", "video", "lyrics"] as StageMode[]).map((next) => (
              <button key={next} className={stageMode === next ? "active" : ""} onClick={() => setStageMode(next)}>
                {{ vinyl: "Vinyl", video: "Video", lyrics: tx("Lyrics", "Lyrics") }[next]}
              </button>
            ))}
          </div>
          {showVideo && (
            <button
              className="btn-secondary"
              onClick={toggleYoutubeControls}
              title={tx("YouTube-Bedienung", "YouTube controls")}
            >
              YT {showControls ? "on" : "off"}
            </button>
          )}
          <div className="volume-wrap">
            <button className={`normalization-toggle${normalization ? " active" : ""}`} onClick={() => setNormalization((value) => !value)} title={normalization ? tx("Lautstärkeausgleich ausschalten", "Disable volume normalization") : tx("Lautstärkeausgleich einschalten", "Enable volume normalization")} aria-pressed={normalization}>⇄ dB</button>
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

      <div className={`mode-section${artistFocus ? " focus-paused" : ""}`}>
        {artistFocus && (
          <div className="focus-note">
            {tx("Band-Fokus ist aktiv. Deine bisherigen Radio-Einstellungen bleiben erhalten.", "Band focus is active. Your radio settings remain unchanged.")}
          </div>
        )}
        <div className="mode-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "band"}
            className={mode === "band" ? "active" : ""}
            onClick={() => changeMode("band")}
          >
            {tx("Künstler", "Artist")}
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
                <span className="anchor-label">{tx("Startband", "Starting band")}</span>
                <span className="anchor-name">{anchor.name}</span>
                <span className="anchor-source">MA</span>
                <button className="btn-secondary btn-sm" onClick={clearAnchor}>
                  {tx("Ändern", "Change")}
                </button>
              </div>
            ) : (
              <div className="anchor-picker">
                <input
                  type="text"
                  className="anchor-input"
                  placeholder={tx("Künstler suchen …", "Search artists …")}
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
              <span className="mode-row-label">{tx("Startband-Anteil", "Starting band share")}</span>
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
            <label className="mode-row">
              <span className="mode-row-label">{tx("Land", "Country")}</span>
              <select value={country} onChange={(event) => void changeCountry((event.target as HTMLSelectElement).value)}>
                <option value="">{tx("Alle Länder", "All countries")}</option>
                {countries.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <div className="mode-row">
              <span className="mode-row-label">{tx("Dekaden", "Decades")}</span>
              <div className="decade-chips">
                {ALL_DECADES.map((d) => (
                  <button
                    key={d}
                    className={`decade-chip${decades.includes(d) ? " active" : ""}`}
                    onClick={() => toggleDecade(d)}
                    aria-pressed={decades.includes(d)}
                  >
                    {language === "de" ? DECADE_LABELS[d] : d}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mode-row">
          <span className="mode-row-label">{tx("Veröffentlichungen", "Releases")}</span>
          <div className="decade-chips">
            {ALL_RELEASE_TYPES.map((item) => (
              <button key={item} className={`decade-chip${releaseTypes.includes(item) ? " active" : ""}`} onClick={() => void toggleReleaseType(item)} aria-pressed={releaseTypes.includes(item)}>
                {{ studio: "Studio", ep: "EP", live: "Live", demo: "Demo", single: "Single", other: tx("Sonstige", "Other") }[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="mode-row">
          <span className="mode-row-label">{tx("Ähnlichkeit", "Similarity")}</span>
          <div className="spread-slider" role="radiogroup">
            {(["narrow", "medium", "wide"] as Spread[]).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={spread === s}
                className={`spread-step${spread === s ? " active" : ""}`}
                onClick={() => changeSpread(s)}
              >
                {language === "de" ? SPREAD_LABELS[s] : { narrow: "Narrow", medium: "Medium", wide: "Wide" }[s]}
              </button>
            ))}
          </div>
        </div>
      </div>


      <div className="kbd-hint">
        <kbd>←</kbd> {tx("Zurück", "Previous")} &nbsp; <kbd>Space</kbd> Play/Pause &nbsp; <kbd>→</kbd> Skip
      </div>
      {maBrowserOpen && (
        <MABrowser
          initialMaId={maBrowserArtist}
          initialAlbumId={maBrowserAlbum}
          currentMaId={current?.maId}
          focusMaId={artistFocus?.maId}
          language={language}
          onClose={() => setMaBrowserOpen(false)}
          onFocus={() => void toggleArtistFocus()}
        />
      )}
    </div>
  )
}

const root = createRoot(document.getElementById("root")!)
root.render(<App />)
