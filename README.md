# KMR (Kaufis Metal Radio) — Version 1.2.0

Ein einfaches Webradio für Metal und verwandte Genres:

- Band eingeben und ähnliche Künstler hören
- Oder Genre + Jahrzehnt wählen
- Läuft im Browser auf deinem eigenen Rechner

## Installation (empfohlen): Docker auf dem Server

```bash
git clone https://github.com/Baulehrer/kmr.git
cd kmr
docker compose up -d
```

KMR wird intern auf Port `3000` bereitgestellt und an das externe Docker-Netzwerk `webproxy` gehängt. Der öffentliche Zugriff läuft über deinen bestehenden Caddy/Reverse Proxy.

Wichtig: Dieses Repo richtet keine Basic Auth ein. Falls du Auth brauchst, passiert das außerhalb von KMR in deiner Caddy-Konfiguration.

Stoppen:

```bash
docker compose down
```

Die Daten bleiben in `./data` erhalten (z. B. Cache und Verlauf).

Lokal ohne Caddy kannst du den Container direkt mit Port-Mapping starten:

```bash
docker build -t kmr:1.2.0 .
docker run --rm -p 3000:3000 -v "$PWD/data:/data" -v "$PWD/artists:/app/artists:ro" kmr:1.2.0
```

Dann öffnen: <http://localhost:3000>

## Neu in Version 1.2

- KMR spielt ausschließlich Bands, die als konkrete ID bei Metal Archives verifiziert wurden.
- Bei gleichnamigen Bands muss der passende Eintrag anhand von Genre, Land und Gründungsjahr ausgewählt werden. `Trouble` unterscheidet dadurch beispielsweise die schwedische Heavy-Metal-Band von der US-Doom-Band.
- Ein YouTube-Kanal wird erst freigegeben, wenn mindestens zwei Titel aus der zugehörigen MA-Diskografie dort gefunden wurden.
- Auch auf einem verifizierten Kanal laufen nur Titel aus genau dieser Diskografie; falsch zusammengeführte Pop-/Rap-Kataloge werden verworfen.
- Der ungeprüfte music-map-Fallback wurde entfernt. Falls eine Band oder ein Track nicht sicher zugeordnet werden kann, überspringt KMR ihn.
- Verlauf, Wiederholungsschutz und Feedback verwenden die MA-ID statt nur des Bandnamens.

## Neu in Version 1.1.1

- Docker bringt jetzt die fehlenden `scrapling`-Runtime-Abhängigkeiten mit: `curl_cffi`, `playwright` und `browserforge`.
- Metal-Archives- und music-map-Abfragen funktionieren dadurch im Container wieder zuverlässig.
- `docker-compose.yml` veröffentlicht keinen Host-Port mehr, sondern nutzt `expose: 3000`.
- Der Container hängt am externen Docker-Netzwerk `webproxy`, damit Caddy KMR intern erreichen kann.
- Keine Auth-Konfiguration im KMR-Repo.

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
.venv/bin/pip install scrapling curl_cffi playwright browserforge
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

Aktuell: `1.2.0`

## Lizenz

MIT — siehe [LICENSE](LICENSE)
