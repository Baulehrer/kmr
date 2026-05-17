export function parseGenre(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/[/,]/)
    .map((g) => g.trim())
    .filter(Boolean)
}

export function matchesGenre(artistGenres: string | string[], targetGenre: string): boolean {
  if (!targetGenre) return true
  const normalized = targetGenre.toLowerCase()
  const list = Array.isArray(artistGenres) ? artistGenres : parseGenre(artistGenres)
  return list.some((g) => g.toLowerCase().includes(normalized))
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
