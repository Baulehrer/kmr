# KMR – Kaufis Metal Radio

Dein persönliches Radio für Rock und Metal. KMR sucht passende Musik, spielt endlos weiter und achtet darauf, dass wirklich die richtige Band läuft – auch bei gleichnamigen Künstlern.

## Das kann KMR

### Musik entdecken

Wähle eine Wunschband und höre ähnliche Künstler. Oder entscheide dich für ein Genre und passende Jahrzehnte. KMR stellt daraus automatisch dein Programm zusammen.

### Verlässliche Rock- und Metal-Auswahl

Bands und Songs werden mit Metal Archives abgeglichen. Dadurch landen keine fremden Künstler im Radio, nur weil sie zufällig denselben Namen tragen.

### Songtexte zum Mitlesen

Öffne während eines Songs die Lyrics-Ansicht. Die gerade gesungene Zeile wird hervorgehoben und wandert automatisch mit. Du kannst eine Zeile anklicken, um zu dieser Stelle zu springen. Mit `−` und `+` lässt sich ein zu früher oder später Songtext korrigieren. Falls kein synchronisierter Text verfügbar ist, zeigt KMR den normalen Songtext.

### Mehr Kontrolle über das Programm

Filtere nach Jahrzehnt, Land sowie Studioalbum, EP, Livealbum, Demo oder Single. Stelle alles in Ruhe ein und starte deine Auswahl anschließend mit **„Let’s Rock!“**. Likes und Dislikes beeinflussen die künftige Auswahl leicht, ohne Bands vollständig auszuschließen. Die Lautstärke kann KMR automatisch angleichen.

Die gesamte Oberfläche lässt sich oben mit den Flaggen zwischen Deutsch und Englisch umschalten.

### Nur diese Band

Gefällt dir der aktuelle Song besonders gut? Mit **„Nur diese Band“** bleibt KMR beim laufenden Künstler. Ein weiterer Klick bringt dich zurück zu deiner vorherigen Auswahl.

### Bandarchiv

Im eingebauten Metal-Archives-Browser findest du:

- Herkunft, Genre, Gründungsjahr und Status
- Themen, Label und Bandmitglieder
- Alben, Cover und vollständige Tracklisten
- ähnliche Bands zum Weiterentdecken

### Deine bevorzugte Ansicht

Wechsle jederzeit zwischen Vinyl, Musikvideo und Lyrics. Verschiedene Farben und Darstellungen machen KMR zu deinem Radio.

## Installation

Die fertigen Programme findest du unter **Releases** auf der GitHub-Seite.

### Windows

1. Lade die Datei `KMR_1.4.1_x64_Setup.exe` herunter.
2. Öffne die Datei und folge den angezeigten Schritten.
3. Starte KMR über das Startmenü oder das Desktop-Symbol.

### macOS

1. Lade die passende DMG-Datei herunter:
   - `aarch64` für Apple Silicon
   - `x86_64` für Intel-Macs
2. Öffne die DMG-Datei und ziehe KMR in den Programme-Ordner.
3. Starte KMR aus „Programme“.

### Linux

1. Lade `KMR_1.4.1_x86_64.AppImage` herunter.
2. Erlaube in den Dateieigenschaften das Ausführen als Programm.
3. Öffne die Datei.

Testpakete mit `unsigned-test` im Namen sind nicht digital signiert. Das Betriebssystem kann deshalb eine zusätzliche Sicherheitsabfrage zeigen.

## Installation mit Docker

Wenn Docker bereits installiert ist, kopiere diese drei Zeilen in ein Terminal:

```bash
git clone https://github.com/Baulehrer/kmr.git
cd kmr
docker compose up -d
```

Öffne danach **http://localhost:3000** im Browser.

KMR später beenden:

```bash
docker compose down
```

## Erste Schritte

1. Öffne KMR und drücke auf „Weiter“, um das Radio zu starten.
2. Wähle unten „Künstler“ oder „Genre“.
3. Nutze „Vinyl“, „Video“ oder „Lyrics“ für deine Lieblingsansicht.
4. Klicke auf den Bandnamen, um das Bandarchiv zu öffnen.
5. Aktiviere „Nur diese Band“, wenn du bei einem Künstler bleiben möchtest.

KMR benötigt eine Internetverbindung für Musik, Songtexte und Bandinformationen. Nicht für jeden Song ist ein Songtext verfügbar.

## Version

Aktuell: **1.4.1**

## Lizenz

MIT – siehe [LICENSE](LICENSE)
