# KMR (Kaufis Metal Radio) — Version 1.1

Ein einfaches Webradio für Metal und verwandte Genres:

- Band eingeben und ähnliche Künstler hören
- Oder Genre + Jahrzehnt wählen
- Läuft im Browser auf deinem eigenen Rechner

## Installation (empfohlen): Docker

```bash
git clone https://github.com/Baulehrer/kmr.git
cd kmr
docker compose up -d
```

Dann öffnen: <http://localhost:3000>

Stoppen:

```bash
docker compose down
```

Die Daten bleiben in `./data` erhalten (z. B. Cache und Verlauf).

## Neu in Version 1.1

- Genre-Modus bleibt strikt im gewählten Metal-Archives-Genre.
- Jahrzehnt-Filter wird nicht mehr automatisch aufgeweicht.
- YouTube-Treffer werden strenger geprüft, damit keine falschen Songs wegen ähnlicher Begriffe laufen.
- Beispiele wie `Kacey Musgraves - Rainbow` werden nicht mehr als Treffer für die Band `Rainbow` akzeptiert.
- Die Videoansicht passt sich besser an die Fenstergröße an.

## Nutzung ohne Docker (lokal)

Voraussetzungen:

- Bun (1.3 oder neuer)
- Python 3.11+

Start:

```bash
bun install
python3 -m venv .venv
.venv/bin/pip install scrapling
bun start
```

Dann öffnen: <http://localhost:3000>

## Eigene Artists-Library (optional)

Lege Ordner pro Band unter `artists/` an:

```text
artists/
  Iron Maiden/
  Judas Priest/
  Black Sabbath/
```

## Release als EXE/App (Windows, Linux, macOS)

Ja, das geht grundsätzlich.

Wichtig: KMR braucht neben dem Hauptprogramm auch Python + `scrapling`. Deshalb ist ein einzelnes "nur EXE"-File auf allen Plattformen nicht ganz trivial.

Praktischer Weg für Releases:

1. Pro Plattform ein Paket bauen (`win`, `linux`, `mac`)
2. Darin enthalten:
   - ausführbare Datei
   - `.venv` mit `scrapling`
   - ggf. Startskript (`start.bat` / `start.sh`)
3. Diese Pakete als GitHub Releases veröffentlichen

Wenn du willst, kann ich dir im nächsten Schritt dafür direkt ein Build-/Release-Setup (z. B. GitHub Actions) anlegen.

## Version

Aktuell: `1.1.0`

## Lizenz

MIT — siehe [LICENSE](LICENSE)
