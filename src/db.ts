import { Database } from "bun:sqlite"

const DB_PATH = process.env.KMR_DB_PATH || (process.env.NODE_ENV === "test" ? ":memory:" : "radio_cache.sqlite")
const db = new Database(DB_PATH, { create: true })
db.run("PRAGMA journal_mode = WAL")
db.run("PRAGMA foreign_keys = ON")

db.run(`
  CREATE TABLE IF NOT EXISTS ma_artists (
    ma_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT,
    genre TEXT,
    country TEXT,
    location TEXT,
    formed_in TEXT,
    updated_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS ma_similar (
    ma_id INTEGER NOT NULL,
    similar_ma_id INTEGER NOT NULL,
    similar_name TEXT NOT NULL,
    similar_genre TEXT,
    similar_country TEXT,
    score INTEGER DEFAULT 0,
    PRIMARY KEY (ma_id, similar_ma_id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS graph_nodes (
    ma_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT,
    country TEXT DEFAULT '',
    updated_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS graph_edges (
    from_ma_id INTEGER NOT NULL,
    to_ma_id INTEGER NOT NULL,
    score INTEGER DEFAULT 0,
    PRIMARY KEY (from_ma_id, to_ma_id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    title TEXT,
    artist TEXT,
    genre TEXT,
    country TEXT,
    duration INTEGER DEFAULT 0,
    source TEXT,
    similar_to TEXT,
    played_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS artist_feedback (
    artist_key TEXT PRIMARY KEY,
    artist TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0,
    dislikes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )
`)

interface ColumnInfo { name: string }

function columnExists(table: string, column: string): boolean {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
  return rows.some((r) => r.name === column)
}

if (!columnExists("ma_artists", "name_key")) {
  db.run("ALTER TABLE ma_artists ADD COLUMN name_key TEXT")
  db.run("UPDATE ma_artists SET name_key = LOWER(TRIM(name)) WHERE name_key IS NULL")
}

if (!columnExists("graph_nodes", "formed_in")) {
  db.run("ALTER TABLE graph_nodes ADD COLUMN formed_in TEXT")
}
if (!columnExists("graph_nodes", "decade")) {
  db.run("ALTER TABLE graph_nodes ADD COLUMN decade TEXT")
}
if (!columnExists("graph_nodes", "source")) {
  db.run("ALTER TABLE graph_nodes ADD COLUMN source TEXT DEFAULT 'ma'")
}
if (!columnExists("history", "hops_from_anchor")) {
  db.run("ALTER TABLE history ADD COLUMN hops_from_anchor INTEGER")
}
if (!columnExists("history", "ma_id")) {
  db.run("ALTER TABLE history ADD COLUMN ma_id INTEGER")
}
if (!columnExists("history", "video_title")) db.run("ALTER TABLE history ADD COLUMN video_title TEXT")
if (!columnExists("history", "album_id")) db.run("ALTER TABLE history ADD COLUMN album_id INTEGER")
if (!columnExists("history", "album")) db.run("ALTER TABLE history ADD COLUMN album TEXT")
if (!columnExists("history", "selection_reason")) db.run("ALTER TABLE history ADD COLUMN selection_reason TEXT")

for (const [column, definition] of [
  ["status", "TEXT DEFAULT ''"],
  ["years_active", "TEXT DEFAULT ''"],
  ["themes", "TEXT DEFAULT ''"],
  ["label", "TEXT DEFAULT ''"],
  ["logo_url", "TEXT DEFAULT ''"],
  ["photo_url", "TEXT DEFAULT ''"],
] as const) {
  if (!columnExists("ma_artists", column)) db.run(`ALTER TABLE ma_artists ADD COLUMN ${column} ${definition}`)
}

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS mm_artists (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_fetched INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS mm_similar (
    from_slug TEXT NOT NULL,
    to_slug TEXT NOT NULL,
    to_name TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    PRIMARY KEY (from_slug, to_slug)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS ma_search_cache (
    name_key TEXT PRIMARY KEY,
    fetched_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS ma_releases (
    ma_id INTEGER NOT NULL,
    album_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    release_type TEXT NOT NULL,
    release_year TEXT NOT NULL DEFAULT '',
    tracks_fetched_at INTEGER,
    PRIMARY KEY (ma_id, album_id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS ma_tracks (
    ma_id INTEGER NOT NULL,
    album_id INTEGER NOT NULL,
    album_title TEXT NOT NULL,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    duration INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ma_id, album_id, title_key)
  )
`)

for (const [column, definition] of [
  ["cover_url", "TEXT DEFAULT ''"],
  ["release_date", "TEXT DEFAULT ''"],
  ["label", "TEXT DEFAULT ''"],
  ["catalog_id", "TEXT DEFAULT ''"],
  ["format", "TEXT DEFAULT ''"],
  ["rating", "INTEGER DEFAULT -1"],
  ["review_count", "INTEGER DEFAULT 0"],
] as const) {
  if (!columnExists("ma_releases", column)) db.run(`ALTER TABLE ma_releases ADD COLUMN ${column} ${definition}`)
}

db.run(`
  CREATE TABLE IF NOT EXISTS ma_members (
    ma_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    member_kind TEXT NOT NULL,
    PRIMARY KEY (ma_id, name, role, member_kind)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS lyrics_cache (
    track_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    synced_lyrics TEXT NOT NULL DEFAULT '',
    plain_lyrics TEXT NOT NULL DEFAULT '',
    fetched_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS ma_browser_search (
    query_key TEXT NOT NULL,
    ma_id INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (query_key, ma_id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS artwork_cache (
    url TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    body BLOB NOT NULL,
    fetched_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS blocked_tracks (
    video_id TEXT PRIMARY KEY,
    ma_id INTEGER NOT NULL,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    blocked_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS youtube_loudness (
    video_id TEXT PRIMARY KEY,
    loudness_db REAL NOT NULL,
    fetched_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS ma_youtube_channels (
    ma_id INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    evidence_count INTEGER NOT NULL,
    verified_at INTEGER NOT NULL,
    PRIMARY KEY (ma_id, channel_id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS ma_youtube_tracks (
    ma_id INTEGER NOT NULL,
    title_key TEXT NOT NULL,
    video_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    video_title TEXT NOT NULL,
    duration INTEGER NOT NULL,
    verified_at INTEGER NOT NULL,
    PRIMARY KEY (ma_id, title_key, video_id)
  )
`)
if (!columnExists("ma_youtube_tracks", "album_id")) {
  db.run("ALTER TABLE ma_youtube_tracks ADD COLUMN album_id INTEGER")
}

db.run("CREATE INDEX IF NOT EXISTS idx_ma_artists_name_key ON ma_artists(name_key)")
db.run("CREATE INDEX IF NOT EXISTS idx_history_played_at ON history(played_at DESC)")
db.run("CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_ma_id)")
db.run("CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_ma_id)")
db.run("CREATE INDEX IF NOT EXISTS idx_graph_nodes_decade ON graph_nodes(decade)")
db.run("CREATE INDEX IF NOT EXISTS idx_graph_nodes_genre ON graph_nodes(genre)")
db.run("CREATE INDEX IF NOT EXISTS idx_mm_similar_from ON mm_similar(from_slug)")
db.run("CREATE INDEX IF NOT EXISTS idx_ma_releases_artist ON ma_releases(ma_id)")
db.run("CREATE INDEX IF NOT EXISTS idx_ma_tracks_artist ON ma_tracks(ma_id)")
db.run("CREATE INDEX IF NOT EXISTS idx_ma_youtube_tracks_artist ON ma_youtube_tracks(ma_id)")

export interface MaArtistRow {
  ma_id: number
  name: string
  name_key: string | null
  genre: string | null
  country: string | null
  location: string | null
  formed_in: string | null
  updated_at: number
  status: string | null
  years_active: string | null
  themes: string | null
  label: string | null
  logo_url: string | null
  photo_url: string | null
}

export interface MaSimilarRow {
  ma_id: number
  similar_ma_id: number
  similar_name: string
  similar_genre: string | null
  similar_country: string | null
  score: number
}

export interface MaReleaseRow {
  ma_id: number
  album_id: number
  title: string
  release_type: string
  release_year: string
  tracks_fetched_at: number | null
  cover_url: string | null
  release_date: string | null
  label: string | null
  catalog_id: string | null
  format: string | null
  rating: number
  review_count: number
}

export interface MaTrackRow {
  ma_id: number
  album_id: number
  album_title: string
  title: string
  title_key: string
  duration: number
  release_type?: string
  release_year?: string
}

export interface MaYoutubeChannelRow {
  ma_id: number
  channel_id: string
  channel_name: string
  evidence_count: number
  verified_at: number
}

export interface MaYoutubeTrackRow {
  ma_id: number
  title_key: string
  video_id: string
  channel_id: string
  video_title: string
  duration: number
  verified_at: number
  album_id: number | null
}

export interface GraphNodeRow {
  ma_id: number
  name: string
  genre: string | null
  country: string | null
  updated_at: number
  formed_in: string | null
  decade: string | null
  source: string | null
}

export interface SettingsRow {
  key: string
  value: string
}

export interface MmArtistRow {
  slug: string
  name: string
  last_fetched: number
}

export interface MmSimilarRow {
  from_slug: string
  to_slug: string
  to_name: string
  score: number
}

export interface GraphEdgeRow {
  from_ma_id: number
  to_ma_id: number
  score: number
}

export interface GraphEdgeWithNodeRow {
  ma_id: number
  name: string | null
  genre: string | null
  country: string | null
  score: number
}

export interface HistoryRow {
  id: number
  video_id: string
  title: string | null
  artist: string | null
  genre: string | null
  country: string | null
  duration: number
  source: string | null
  similar_to: string | null
  played_at: number
  hops_from_anchor: number | null
  ma_id: number | null
  video_title: string | null
  album_id: number | null
  album: string | null
  selection_reason?: string | null
}

export interface MaMemberRow {
  ma_id: number
  name: string
  role: string
  member_kind: "current" | "past" | "live"
}

export interface LyricsCacheRow {
  track_key: string
  kind: "synced" | "plain" | "missing"
  synced_lyrics: string
  plain_lyrics: string
  fetched_at: number
}

export interface ArtworkCacheRow {
  url: string
  content_type: string
  body: Uint8Array
  fetched_at: number
}

export interface ArtistFeedbackRow {
  artist_key: string
  artist: string
  likes: number
  dislikes: number
  updated_at: number
}

export default db
