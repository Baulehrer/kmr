# Radio — Internetradio aus der Musiksammlung

## Ziel
Eine Engine, die aus der lokalen Künstlersammlung (Ordnerstruktur) ein genre-basiertes Internetradio generiert. Die Engine sucht per YouTube (Innertube), spielt per YouTube-iframe, und erweitert den Musikkorpus durch Similar Artists aus den Metal Archives. Keine lokalen Downloads, keine Werbung.

## Architekturüberblick

```
┌──────────────────────┐
│                     Radio Engine (Bun + TypeScript)          │
│                                 │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│  │ Library  │──▶│  Scheduler   │──▶│   YouTube Player     │  │
│  │ (Artists)│   │  (Algorithm) │   │   (IFrame API, Web)  │  │
│  └──────────┘   └──────┬───────┘   └──────────────────────┘  │
│                        │                                     │
│                ┌───────┴───────┐                             │
│                │   Resolver    │                             │
│                │ ┌───────────┐ │                             │
│                │ │ MA-Client │ │  Metal Archives             │
│                │ │ (Scraper) │ │  - Genre-Prüfung            │
│                │ └───────────┘ │  - Similar Artists          │
│                │ ┌───────────┐ │  - Artist → ID Mapping      │
│                │ │ YT-Client │ │  YouTube (Innertube)        │
│                │ │(youtubei) │ │  - Suche "<artist> <track>" │
│                │ └───────────┘ │  - Video-ID + Titel         │
│                └───────────────┘                             │
│                                 │
│  REST API (Bun.serve)                                        │
│  GET  /api/radio/play     → aktuellen Track                  │
│  GET  /api/radio/next     → nächsten Track                   │
│  GET  /api/radio/history  → History                          │
│  GET  /api/radio/queue    → Warteschlange                    │
│  POST /api/radio/skip     → überspringen                     │
│  GET  /api/genres         → verfügbare Genres                │
│  POST /api/genre/select   → Genre wählen                     │
│  GET  /api/graph          → Artist-Graph (als JSON)          │
│                                 │
│  Später: Docker, HTML-Frontend (IFrame-Player), TUI          │
└──────────────────────┘
```

## Phase 1: Foundation (Grundgerüst)

### 1.1 Projekt-Scaffold
- Bun + TypeScript Projekt initialisieren
- `Bun.serve()` als HTTP-Server
- Ordnerstruktur:
  ```
  src/
    server.ts          # HTTP-Server, Routen
    library.ts          # Künstlersammlung einlesen
    ma-client.ts        # Metal Archives Scraper
    yt-client.ts        # YouTube Innertube Client
    resolver.ts         # Artist → YouTube Video-ID
    scheduler.ts        # Algorithmus: Track-Auswahl
    queue.ts            # Play-Queue
    graph.ts            # Artist-Graph (Similar Artists)
    types.ts            # Gemeinsame Typen
  ```

### 1.2 Library-Modul
- Liest die Ordnerstruktur unter `./artists/` ein
- Jeder Ordner = ein Künstlername
- Baut eine `Map<string, Artist>` auf
- `Artist` hat Felder: `name`, `maId` (optional, via MA-Suche), `genres`, `similarIds`

### 1.3 Metal Archives Client (`ma-client.ts`)
- HTTP-Scraper für metal-archives.com
- Endpunkte:
  - `GET /search/ajax-advanced/searching/bands/?bandName=...` → Bandsuche
  - `GET /bands/_/<name>/<id>` → Band-Detailseite (Genre, ID)
  - `GET /band/ajax-recommendations/id/<id>` → Similar Artists (JSON-ähnliche HTML-Tabelle)
- Funktionen:
  - `searchArtist(name: string): Promise<MASearchResult | null>`
  - `getArtistDetail(maId: number): Promise<MAArtistDetail>`
  - `getSimilarArtists(maId: number): Promise<SimilarArtist[]>`
- Rate-Limiting: max 1 Request/Sekunde (REQUEST_TIMEOUT)
- Caching: `Bun.sqlite` für persistente MA-Daten
- Genre-Validierung: Prüft ob Band in MA gelistet ist und Genre Heavy/Power/Doom/Stoner/Speed/Thrash/Traditional enthält

### 1.4 YouTube Client (`yt-client.ts`)
- Nutzt `youtubei.js` (Innertube) — keine API-Key, keine Quota
- Session-Management: `Innertube.create()` mit Caching
- Funktion:
  - `searchTrack(artist: string, track?: string): Promise<YTVideo | null>`
  - Rückgabe: ` videoId, title, channelName, duration }`
- Suchstrategie: `<artist> - <album/track>` oder `<artist>` allein
- Fallback: Wenn kein Ergebnis, populärsten Track des Künstlers via YouTube-Suche finden

### 1.5 Resolver
- Verkettet MA-Client + YT-Client
- `resolveTrack(artist: Artist): Promise<ResolvedTrack>`
  1. Prüft MA-Cache → Genre-Validierung
  2. Sucht YouTube-Video
  3. Gibt `ResolvedTrack` zurück: ` videoId, title, artist, genre, duration }`

### 1.6 Artist-Graph (`graph.ts`)
- Baut Graphen aus Similar Artists Beziehungen
- Wird lazy aufgebaut: Wenn ein Artist zum ersten Mal gespielt wird, werden seine Similar Artists geladen
- Struktur: `Map<maId, { artist, similarIds: number[], genres: string[] }>`
- Persistenz in SQLite
- API: `getSimilar(maId: number): number[]`, `getArtistsInGenre(genre: string): number[]`

## Phase 2: Algorithmus (`scheduler.ts`)

### 2.1 Genre-Einschränkung
- Nutzer wählt ein MA-Genre (z.B. "Heavy Metal", "Doom Metal", "Power Metal")
- Nur Artists mit passendem Genre werden gespielt
- Genre-Matching: Substring-Match ("Heavy Metal" matcht "Heavy Metal", "Heavy/Power Metal", etc.)

### 2.2 Track-Auswahl (gewichteter Random-Walk)
1. Start: Wähle zufälligen Artist aus der Library, der im gewählten Genre bei MA gelistet ist
2. Für den Artist: Suche YouTube-Video → spiele es
3. Nach dem Track: Mit 70% Wahrscheinlichkeit → Similar Artist (aus Graph)
   Mit 30% Wahrscheinlichkeit → zufälliger Library-Artist im Genre
4. Similar Artist Auswahl: Gewichtet nach MA-Score (höherer Score = höhere Chance)
5. Wiederholungssperre: Zuletzt gespielte 50 Artists werden nicht wiederholt

### 2.3 Queue-Management
- Prefetch: Wenn Queue < 5 Tracks, fülle asynchron auf
- `QueueItem`: ` resolvedTrack, scheduledAt, playedAt }`
- History: Letzte 200 Tracks in SQLite

## Phase 3: REST API

### Endpunkte
| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/radio/current` | Aktuell laufender Track |
| GET | `/api/radio/next` | Warteschlange (Queue) |
| GET | `/api/radio/history` | Letzte N Tracks |
| POST | `/api/radio/skip` | Überspringe aktuellen Track |
| POST | `/api/radio/pause` | Pausiere |
| POST | `/api/radio/resume` | Setze fort |
| GET | `/api/genres` | Verfügbare Genres aus MA |
| POST | `/api/genre` | Setze Genre ` genre: "Doom Metal" }` |
| GET | `/api/graph` | Artist-Graph als JSON (für spätere Visualisierung) |
| GET | `/api/artists/search?q=...` | Künstlersuche in Library + MA |

### Antwortformat
```json
{
  "current": {
    "videoId": "dQw4w9WgXcQ",
    "title": "Iron Maiden - The Trooper",
    "artist": "Iron Maiden",
    "genre": "Heavy Metal",
    "source": "similar",            // "library" | "similar" | "discovery"
    "similarTo": "Judas Priest",    // falls source=similar
    "progress": 124,                // Sekunden
    "duration": 245
  },
  "queue": [...]
}
```

## Phase 4: Konfiguration & Startup

### `radio.config.ts`
```ts
export default {
  libraryPath: "./artists",
  maRateLimit: 1000,       // ms zwischen Requests
  queueSize: 10,           // Warteschlangen-Größe
  repeatProtection: 50,    // letzte N Artists sperren
  similarWeight: 0.7,      // 70% Similar, 30% Random
  defaultGenre: "Heavy Metal",
  server: { port: 3000 }
}
```

### Startup-Sequenz
1. Library einlesen (Ordnerstruktur)
2. SQLite-DB öffnen (MA-Cache, History, Graph)
3. Innertube-Session aufbauen
4. Genre setzen (Default: Heavy Metal)
5. Initial Queue befüllen (im Hintergrund)
6. HTTP-Server starten

## Technische Entscheidungen

### Warum Bun statt Node?
- Native `Bun.serve()` (kein Express nötig)
- `bun:sqlite` für Caching (kein better-sqlite3)
- `Bun.$\`cmd\`` für Shell-Tasks
- Lädt `.env` automatisch

### Warum `youtubei.js` statt YouTube Data API?
- Keine Quota-Limits (Data API: 10.000/Tag → ~100 Suchen)
- Keine API-Key-Verwaltung
- Liefert native YouTube-Suchergebnisse
- Risiko: Kann bei YouTube-Updates brechen → Abstraktion hinter Interface, Austausch möglich

### Warum eigener MA-Scraper statt `python-metallum`?
- `python-metallum` hat kein `similar_artists`
- Der Ajax-Endpunkt `/band/ajax-recommendations/id/<id>` ist einfach zu scrapen
- Vollständige Kontrolle über Rate-Limiting und Caching

### Graph-Visualisierung (später)
- Der Artist-Graph liegt als JSON vor
- Kann später mit D3.js / vis.js im Frontend visualisiert werden
- Zeigt Verbindungen zwischen Artists im aktuellen Genre

## Nächste Schritte nach diesem Plan
1. Docker-Container für die Engine
2. HTML-Frontend mit YouTube IFrame API
   - Autoplay, Next-Track-Übergang
   - "Now Playing"-Anzeige mit Artist, Titel, Genre
   - Genre-Auswahl per Dropdown
3. TUI (mit `blessed` oder `ink`)

## Offene Fragen für später
- Soll das Radio 24/7 laufen oder on-demand?
- Mehrere parallele "Sender" (pro Genre einer)?
- User-Feedback (Like/Dislike → beeinflusst Algorithmus)?
