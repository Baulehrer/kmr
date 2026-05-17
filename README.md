# KMR — Kaufis Metal Radio

> Endloses Internetradio, das dich nicht zur Charts-Schleife verdammt. Du gibst eine Band oder ein Genre vor — KMR baut den Rest.

Kein Account, keine Werbung, keine Algorithmen, die dich in deine eigene Blase einschließen. KMR liest die Musikwelt aus der Metal-Archives-Datenbank und music-map.com und sucht zu jedem Künstler ähnliche Bands. Wiedergegeben wird über die YouTube-Suche.

---

## Was es kann

### Zwei Modi

- **Künstler-Modus** — Du tippst „Iron Maiden" ein, KMR setzt die Band als Anker und spielt von da an ähnliche Künstler. Ein Ähnlichkeits-Slider entscheidet, wie weit das Radio sich vom Anker entfernen darf (1, 2 oder 3 Hops im Ähnlichkeitsgraph).
- **Genre-Modus** — Du wählst ein Genre aus der Metal-Archives-Taxonomie und (optional) eine oder mehrere Dekaden (70er, 80er, 90er, 2000er, 2010er, 2020er). Der Slider regelt, wie streng beim Genre geblieben wird.

### Datenquellen

- **Metal-Archives** — Genre-Taxonomie und „Recommended Bands" für alles, was Metal ist.
- **music-map.com** — Ähnlichkeitsnetz für alle anderen Genres. Wer nicht in MA gelistet ist, wird automatisch hier nachgeschlagen (Pink Floyd, Radiohead, …).
- **YouTube** — Audio-Quelle. Songs werden gezielt nach `<Künstler> song` / `<Künstler> official audio` gesucht und gegen Titel-Heuristiken gefiltert, damit TED-Talks, Interviews und Reaction-Videos nicht in der Queue landen.

### Bedienung

- **Vinyl-Carousel** — Aktueller Track als rotierende Schallplatte in der Mitte, History links, Queue rechts. Alle Discs sind anklickbar — zurück- oder vorspringen geht direkt per Klick.
- **Tasten**: `Space` Play/Pause · `←` zurück · `→` skip
- **Like / Dislike** — Eingriff in die Auswahlgewichte. Drei Net-Dislikes blockieren einen Künstler komplett.
- **Drei Ansichten**: Vinyl (rotierend), Karten (Album-Cover-Look), Kompakt (Minimal)
- **Zehn Themes**: Classic Metal · Midnight · Forest · Sunset · Lavender · Mono · Vapor · Paper · Terminal · Gold

### Komfort

- Mode, Anker, Genre, Dekaden und Slider werden persistiert — beim Neustart ist alles wie gehabt.
- Wechselt du ein Setting, wird der aktuelle Track sofort durch einen passenden ersetzt; die Queue baut sich neu auf.
- Eingebauter SQLite-Cache: Ähnlichkeitsabfragen kosten nur einmal Netzwerktraffic.

---

## Schnellstart mit Docker

```bash
git clone https://github.com/<dein-user>/kmr.git
cd kmr
docker compose up -d
```

Danach läuft KMR auf <http://localhost:3000>.

Die Container-Variante kümmert sich um Bun, Python, das scrapling-venv und legt einen Daten-Volume `./data` an, in dem die SQLite-Cache-Datenbank liegt. So bleiben deine Likes, Anker und der Ähnlichkeitsgraph beim Neustart erhalten.

### Konfiguration via Umgebungsvariablen

| Variable | Default | Bedeutung |
|---|---|---|
| `KMR_DB_PATH` | `./radio_cache.sqlite` (Container: `/data/radio_cache.sqlite`) | Pfad zur SQLite-Cache-Datei |
| `KMR_LIBRARY_PATH` | `./artists` | Verzeichnis mit Künstler-Unterordnern (jeder Ordner = ein Library-Künstler) |

---

## Lokale Entwicklung

Voraussetzungen:

- [Bun](https://bun.sh) ≥ 1.3
- Python ≥ 3.11 mit `venv`

```bash
bun install

# Python-Helfer für die Scraper
python3 -m venv .venv
.venv/bin/pip install scrapling

# Start
bun start
# oder mit HMR
bun dev
```

Tests:

```bash
bun test
bun run typecheck
```

---

## Library anlegen

Die lokale Künstler-Bibliothek ist ein Fallback und Seed für den Random-Walk. Jeder Künstler ist einfach ein leerer Ordner unter `artists/`:

```
artists/
├── Iron Maiden/
├── Judas Priest/
├── Black Sabbath/
└── …
```

Der Name des Ordners wird gegen Metal-Archives aufgelöst, Genre und Country werden gecacht.

---

## Roadmap

### 0.5 (aktuell)
- Band-Anker via Metal-Archives + music-map.com
- Genre + Multi-Dekaden-Filter
- Vinyl-Carousel mit klickbarer History/Queue
- Drei Ansichten, zehn Themes
- Persistenter State über Neustarts

### 0.6 (next)
- Bugfixing-Runde
- **Lyric-Support** — Liedtexte direkt im Player anzeigen
- Gnoosic-Integration als dritte Ähnlichkeitsquelle

### Später
- Mehrfachauswahl Genres
- Playlist-Export / Share-Links
- Stats-Dashboard (Hörverhalten, Anker-Wechsel, Drift)

---

## Stack

- Runtime: [Bun](https://bun.sh) (HTTP-Server, SQLite, Bundler)
- Frontend: React 19, Plain CSS, Vinyl-Animations
- Scraping: Python + [scrapling](https://github.com/D4Vinci/Scrapling) (Cloudflare-Bypass)
- YouTube: [youtubei.js](https://github.com/LuanRT/YouTube.js)

---

## Lizenz

MIT — siehe [LICENSE](LICENSE).
