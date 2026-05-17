import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Artist } from "./types"
import { normalizeName } from "./genre"
import config from "./radio.config"

const artists = new Map<string, Artist>()

export function loadLibrary(): Map<string, Artist> {
  const libPath = config.libraryPath
  let entries: string[]
  try {
    entries = readdirSync(libPath)
  } catch {
    console.warn(`Library path "${libPath}" not found, creating empty library.`)
    return artists
  }

  for (const entry of entries) {
    const fullPath = join(libPath, entry)
    let isDir = false
    try {
      isDir = statSync(fullPath).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue

    const name = entry.trim()
    if (!name || name.startsWith(".")) continue
    artists.set(normalizeName(name), {
      name,
      maId: null,
      genres: [],
      country: "",
      similarIds: [],
      source: "library",
    })
  }

  console.log(`Library loaded: ${artists.size} artists from "${libPath}"`)
  return artists
}

export function getArtist(name: string): Artist | undefined {
  return artists.get(normalizeName(name))
}

export function getAllArtists(): Artist[] {
  return [...artists.values()]
}

export function updateArtist(name: string, partial: Partial<Artist>): void {
  const existing = artists.get(normalizeName(name))
  if (existing) {
    Object.assign(existing, partial)
  }
}

export function getLibrarySize(): number {
  return artists.size
}
