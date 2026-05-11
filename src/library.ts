import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Artist } from "./types"
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
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      const name = entry.trim()
      artists.set(name.toLowerCase(), {
        name,
        maId: null,
        genres: [],
        country: "",
        similarIds: [],
        source: "library",
      })
    }
  }

  console.log(`Library loaded: ${artists.size} artists from "${libPath}"`)
  return artists
}

export function getArtist(name: string): Artist | undefined {
  return artists.get(name.toLowerCase())
}

export function getAllArtists(): Artist[] {
  return [...artists.values()]
}

export function updateArtist(name: string, partial: Partial<Artist>): void {
  const key = name.toLowerCase()
  const existing = artists.get(key)
  if (existing) {
    Object.assign(existing, partial)
  }
}

export function getLibrarySize(): number {
  return artists.size
}
