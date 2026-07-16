import { searchArtists } from "./ma-client"
import { normalizeName } from "./genre"
import type { Anchor, MASearchResult } from "./types"

export interface AnchorCandidate {
  source: "ma"
  sourceId: string
  name: string
  hint: string
  genre: string
  country: string
  formedIn: string | null
}

export function exactArtistMatches(name: string, candidates: MASearchResult[]): MASearchResult[] {
  const key = normalizeName(name)
  return candidates.filter((candidate) => normalizeName(candidate.name) === key)
}

/**
 * Resolves a free-text band name only when Metal Archives has one exact match.
 * Ambiguous names must be selected by MA ID through the candidate endpoint.
 */
export async function resolveAnchor(name: string): Promise<Anchor | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const exact = exactArtistMatches(trimmed, await searchArtists(trimmed))
  if (exact.length !== 1) return null
  const ma = exact[0]!
  return {
    source: "ma",
    sourceId: String(ma.maId),
    name: ma.name,
    genre: ma.genre,
    country: ma.country,
    formedIn: ma.formedIn,
  }
}

export async function resolveAnchorCandidate(name: string, sourceId: string): Promise<Anchor | null> {
  const maId = Number.parseInt(sourceId, 10)
  if (!Number.isInteger(maId) || maId <= 0) return null
  const match = (await searchArtists(name)).find(
    (candidate) => candidate.maId === maId && normalizeName(candidate.name) === normalizeName(name),
  )
  if (!match) return null
  return {
    source: "ma",
    sourceId: String(match.maId),
    name: match.name,
    genre: match.genre,
    country: match.country,
    formedIn: match.formedIn,
  }
}

/**
 * Returns all MA candidates so exact namesakes can be selected by identity.
 */
export async function lookupAnchorCandidates(name: string): Promise<AnchorCandidate[]> {
  const trimmed = name.trim()
  if (!trimmed) return []
  try {
    return (await searchArtists(trimmed)).map((ma) => ({
      source: "ma" as const,
      sourceId: String(ma.maId),
      name: ma.name,
      hint: [ma.genre, ma.country, ma.formedIn ? `seit ${ma.formedIn}` : ""].filter(Boolean).join(" · ") || "Metal Archives",
      genre: ma.genre,
      country: ma.country,
      formedIn: ma.formedIn,
    }))
  } catch {
    return []
  }
}
