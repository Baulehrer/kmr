# KMR bauen und veröffentlichen

Die technische Release-Automation liegt in `.github/workflows/release.yml`. Ein Tag wie `v1.4.1` startet Tests und erzeugt Docker-, Linux-, Windows- und macOS-Artefakte.

## Desktop-Sidecars

`bun run desktop:prepare` kompiliert den Bun-Server und den Python-basierten MA-Adapter für den nativen Rust-Target-Triple. Benötigt werden Rust, Bun, Python, PyInstaller und die Python-Pakete aus dem Dockerfile.

## Optionale Signaturen

- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- Windows: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`

Ohne diese Secrets bleiben die automatisch veröffentlichten Desktop-Dateien als `unsigned-test` gekennzeichnet.
