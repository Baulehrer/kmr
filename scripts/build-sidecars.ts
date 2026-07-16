import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const binaries = join(root, "src-tauri", "binaries")
await mkdir(binaries, { recursive: true })
await mkdir(join(root, ".desktop-build"), { recursive: true })

const rustc = Bun.spawnSync(["rustc", "-vV"], { stdout: "pipe" })
if (rustc.exitCode !== 0) throw new Error("Rust ist nicht installiert")
const host = rustc.stdout.toString().match(/^host:\s*(.+)$/m)?.[1]?.trim()
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host
if (!target) throw new Error("Zielplattform konnte nicht ermittelt werden")
const windows = target.includes("windows")
const suffix = windows ? ".exe" : ""

const serverOutput = join(binaries, `kmr-server-${target}${suffix}`)
const server = Bun.spawnSync(["bun", "build", "src/server.ts", "--compile", "--minify", "--outfile", serverOutput], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
if (server.exitCode !== 0) throw new Error("KMR-Server konnte nicht gebaut werden")

const pyinstaller = Bun.spawnSync([
  process.env.PYTHON || "python3", "-m", "PyInstaller",
  "--noconfirm", "--clean", "--onefile",
  "--collect-all", "scrapling",
  "--collect-all", "curl_cffi",
  "--collect-all", "browserforge",
  "--collect-all", "apify_fingerprint_datapoints",
  "--name", `kmr-ma-adapter-${target}`,
  "--distpath", binaries,
  "--workpath", join(root, ".desktop-build", "pyinstaller"),
  "--specpath", join(root, ".desktop-build"),
  "src/scrapling_adapter.py",
], { cwd: root, stdout: "inherit", stderr: "inherit" })
if (pyinstaller.exitCode !== 0) throw new Error("MA-Adapter konnte nicht gebaut werden")

await rm(join(root, ".desktop-build", "pyinstaller"), { recursive: true, force: true })
console.log(`Sidecars für ${target} bereit`)
