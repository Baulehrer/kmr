export function parseGenre(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/[/,]/)
    .map((g) => g.trim())
    .filter(Boolean)
}

export const CANONICAL_GENRES = [
  "Black",
  "Death",
  "Doom/Stoner/Sludge",
  "Electronic/Industrial",
  "Experimental/Avant-garde",
  "Folk/Viking/Pagan",
  "Gothic",
  "Grindcore",
  "Groove",
  "Heavy",
  "Metalcore/Deathcore",
  "Power",
  "Progressive",
  "Speed",
  "Symphonic",
  "Thrash",
] as const

export type CanonicalGenre = (typeof CANONICAL_GENRES)[number]

/**
 * Map MA genre string → canonical category.
 * Priority: most specific patterns first, broader keywords later.
 */
const GENRE_KEYWORD_MAP: [pattern: string, canonical: CanonicalGenre][] = [
  ["Deathcore", "Metalcore/Deathcore"],
  ["Metalcore", "Metalcore/Deathcore"],
  ["Symphonic", "Symphonic"],
  ["Gothic", "Gothic"],
  ["Goregrind", "Grindcore"],
  ["Grindcore", "Grindcore"],
  ["Folk", "Folk/Viking/Pagan"],
  ["Viking", "Folk/Viking/Pagan"],
  ["Pagan", "Folk/Viking/Pagan"],
  ["Avant", "Experimental/Avant-garde"],
  ["Experimental", "Experimental/Avant-garde"],
  ["Doom", "Doom/Stoner/Sludge"],
  ["Stoner", "Doom/Stoner/Sludge"],
  ["Sludge", "Doom/Stoner/Sludge"],
  ["Industrial", "Electronic/Industrial"],
  ["Electronic", "Electronic/Industrial"],
  ["Electro", "Electronic/Industrial"],
  ["Darkwave", "Electronic/Industrial"],
  ["Neoclassical", "Symphonic"],
  ["Progres", "Progressive"],
  ["Power", "Power"],
  ["Speed", "Speed"],
  ["Thrash", "Thrash"],
  ["Groove", "Groove"],
  ["Death", "Death"],
  ["Black", "Black"],
  ["Heavy", "Heavy"],
]

/** Map any MA genre string to a canonical category, or null if no match. */
export function toCanonicalGenre(raw: string): string | null {
  const lower = raw.toLowerCase()
  for (const [pattern] of GENRE_KEYWORD_MAP) {
    if (lower.includes(pattern.toLowerCase())) {
      return GENRE_KEYWORD_MAP.find(([k]) => k === pattern)![1]
    }
  }
  return null
}

/** Filter a list of raw genres to unique canonical categories. */
export function filterCanonical(rawGenres: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of rawGenres) {
    const canonical = toCanonicalGenre(raw)
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical)
      out.push(canonical)
    }
  }
  return out
}

export function matchesGenre(artistGenres: string | string[], targetGenre: string): boolean {
  if (!targetGenre) return true
  const normalized = targetGenre.toLowerCase()
  const targetCanonical = toCanonicalGenre(targetGenre)
  const list = Array.isArray(artistGenres) ? artistGenres : parseGenre(artistGenres)
  return list.some((g) => {
    if (g.toLowerCase().includes(normalized)) return true
    const artistCanonical = toCanonicalGenre(g)
    return !!targetCanonical && artistCanonical === targetCanonical
  })
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

import type { Decade } from "./types"

export function parseDecade(formedIn: string | null | undefined): Decade | null {
  if (!formedIn) return null
  const match = formedIn.match(/(\d{4})/)
  if (!match) return null
  const year = parseInt(match[1]!, 10)
  if (year < 1900 || year > 2099) return null
  if (year < 1980) return "70s"
  if (year < 1990) return "80s"
  if (year < 2000) return "90s"
  if (year < 2010) return "00s"
  if (year < 2020) return "10s"
  return "20s"
}

export function matchesDecade(decade: Decade | null, wanted: Decade[]): boolean {
  if (wanted.length === 0) return true
  if (!decade) return false
  return wanted.includes(decade)
}
