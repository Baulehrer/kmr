import { Database } from "bun:sqlite"

const DB_PATH = process.env.KMR_DB_PATH || "radio_cache.sqlite"
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

db.run("CREATE INDEX IF NOT EXISTS idx_ma_artists_name_key ON ma_artists(name_key)")
db.run("CREATE INDEX IF NOT EXISTS idx_history_played_at ON history(played_at DESC)")
db.run("CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_ma_id)")
db.run("CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_ma_id)")
db.run("CREATE INDEX IF NOT EXISTS idx_graph_nodes_decade ON graph_nodes(decade)")
db.run("CREATE INDEX IF NOT EXISTS idx_graph_nodes_genre ON graph_nodes(genre)")
db.run("CREATE INDEX IF NOT EXISTS idx_mm_similar_from ON mm_similar(from_slug)")

export interface MaArtistRow {
  ma_id: number
  name: string
  name_key: string | null
  genre: string | null
  country: string | null
  location: string | null
  formed_in: string | null
  updated_at: number
}

export interface MaSimilarRow {
  ma_id: number
  similar_ma_id: number
  similar_name: string
  similar_genre: string | null
  similar_country: string | null
  score: number
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
}

export interface ArtistFeedbackRow {
  artist_key: string
  artist: string
  likes: number
  dislikes: number
  updated_at: number
}

export default db
