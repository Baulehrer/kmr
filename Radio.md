# Radio — Internetradio aus der Musiksammlung

Genre-basiertes Internetradio, das aus der lokalen Künstlersammlung (`./artists/`) per Metal Archives (Similar Artists) und YouTube (Innertube) Tracks generiert. Keine lokalen Downloads, keine Werbung.

## Architektur

```
┌──────────────────────────────────────────────────────────────┐
│                    Radio Engine (Bun + TypeScript)            │
│                                                              │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│  │ Library  │──▶│  Scheduler   │──▶│   YouTube Player     │  │
│  │ (Artists)│   │ (Algorithm)  │   │   (IFrame API, Web)  │  │
│  └──────────┘   └──────┬───────┘   └──────────────────────┘  │
│                        │                                     │
│                ┌───────┴───────┐                             │
│                │   Resolver    │                             │
│                │ ┌───────────┐ │  Metal Archives             │
│                │ │ MA-Client │ │  - Genre- & Country-Check  │
│                │ │ (Scrapling)│ │  - Similar Artists          │
│                │ └───────────┘ │  - Artist → ID Mapping       │
│                │ ┌───────────┐ │  YouTube (Innertube)        │
│                │ │ YT-Client │ │  - Suche "<artist> <track>" │
│                │ │(youtubei) │ │  - Video-ID + Titel         │
│                │ └───────────┘ │                             │
│                └───────────────┘                             │
│                                                              │
│  REST API (Bun.serve)                                        │
│  GET  /api/radio/current  → aktueller Track                 │
│  GET  /api/radio/next      → nächsten Track spielen         │
│  GET  /api/radio/history   → History                        │
│  GET  /api/radio/queue     → Warteschlange                  │
│  POST /api/radio/skip      → überspringen                   │
│  POST /api/radio/pause     → pausieren                      │
│  POST /api/radio/resume    → fortsetzen                     │
│  GET  /api/genres          → verfügbare Genres              │
│  POST /api/genre           → Genre wählen                   │
│  GET  /api/countries       → verfügbare Länder              │
│  POST /api/country         → Land wählen/leeren             │
│  GET  /api/graph           → Artist-Graph (JSON)            │
│  GET  /api/artists/search  → Künstlersuche                  │
└──────────────────────────────────────────────────────────────┘
```

## Module (`src/`)

| Datei | Beschreibung |
|-------|-------------|
| `types.ts` | Gemeinsame Typen (Artist, ResolvedTrack, QueueItem, etc.) |
| `radio.config.ts` | Konfiguration (Genre, Country, Queue-Größe, Rate-Limits) |
| `library.ts` | Liest `./artists/` Ordnerstruktur ein |
| `scrapling_adapter.py` | Python-Adapter für Scrapling (MA-Scraper mit Anti-Bot-Bypass) |
| `ma-client.ts` | Metal Archives Client via Scrapling-Subprocess |
| `yt-client.ts` | YouTube Innertube Client (youtubei.js, kein API-Key) |
| `resolver.ts` | Verkettet MA-Genre-/Country-Validierung + YouTube-Suche |
| `graph.ts` | Artist-Graph (Similar Artists) mit SQLite-Persistenz |
| `queue.ts` | Play-Queue mit Prefetch, History, Repeat-Protection |
| `scheduler.ts` | Gewichteter Random-Walk (70% Similar / 30% Random), Genre + Country Filter |
| `server.ts` | REST API + Startup-Sequenz |

## Konfiguration (`src/radio.config.ts`)

```ts
{
  libraryPath: "./artists",
  maRateLimit: 1000,       // ms zwischen MA-Requests
  queueSize: 10,
  prefetchThreshold: 5,
  repeatProtection: 50,    // letzte N Artists sperren
  similarWeight: 0.7,      // 70% Similar, 30% Random
  defaultGenre: "Heavy Metal",
  defaultCountry: "",       // leer = alle Länder
  server: { port: 3000 }
}
```

## Setup

```sh
# Python-venv + Scrapling
python3 -m venv .venv
.venv/bin/pip install "scrapling[fetchers]"

# Bun-Dependencies
bun install

# Künstler-Ordner anlegen
mkdir -p artists/"Iron Maiden" artists/"Judas Priest" artists/"Black Sabbath"

# Server starten
bun src/server.ts
```

## API-Beispiele

```sh
# Aktuellen Track abfragen
curl http://localhost:3000/api/radio/current

# Genre setzen
curl -X POST http://localhost:3000/api/genre -H 'Content-Type: application/json' -d '{"genre":"Doom Metal"}'

# Land setzen (Substring-Match, z.B. "United" matcht "United Kingdom" & "United States")
curl -X POST http://localhost:3000/api/country -H 'Content-Type: application/json' -d '{"country":"United Kingdom"}'

# Land-Filter leeren (alle Länder)
curl -X POST http://localhost:3000/api/country -H 'Content-Type: application/json' -d '{}'

# Track überspringen
curl -X POST http://localhost:3000/api/radio/skip
```

## Track-Antwortformat

```json
{
  "current": {
    "videoId": "dQw4w9WgXcQ",
    "title": "Iron Maiden - The Trooper",
    "artist": "Iron Maiden",
    "genre": "Heavy Metal",
    "country": "United Kingdom",
    "source": "library",
    "similarTo": null,
    "progress": 124,
    "duration": 245
  }
}
```

## Anti-Bot-Bypass (Scrapling)

Metal Archives blockiert einfache HTTP-Requests mit 403. Der `scrapling_adapter.py` nutzt Scrapling's `Fetcher` mit TLS-Fingerprint-Impersonierung und `stealthy_headers=True`, der Cloudflare/Bot-Detection umgeht. Der TypeScript-Code ruft den Python-Adapter via `Bun.spawn()` als Subprocess auf.

## Nächste Schritte

1. HTML-Frontend mit YouTube IFrame API (Autoplay, Next-Track, Genre-/Country-Dropdown)
2. Docker-Container
3. TUI (blessed / ink)
4. Mehrere parallele "Sender" (pro Genre/Country einer)
5. User-Feedback (Like/Dislike → beeinflusst Algorithmus)
