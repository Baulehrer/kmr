import { searchArtist } from "./ma-client"
import { getMusicMapSimilar, musicMapSlug } from "./musicmap-client"
import type { Anchor } from "./types"

export interface AnchorCandidate {
  source: "ma" | "musicmap"
  sourceId: string
  name: string
  hint: string
}

/**
 * Resolves a free-text band name to an anchor. Prefers Metal-Archives because
 * it has the richer similarity graph; falls back to music-map.com for bands
 * MA does not know (most non-Metal).
 */
export async function resolveAnchor(name: string): Promise<Anchor | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  try {
    const ma = await searchArtist(trimmed)
    if (ma?.maId) {
      return { source: "ma", sourceId: String(ma.maId), name: ma.name }
    }
  } catch (err: any) {
    console.warn(`MA search failed for "${trimmed}":`, err.message)
  }

  try {
    const similar = await getMusicMapSimilar(trimmed)
    if (similar.length > 0) {
      return { source: "musicmap", sourceId: musicMapSlug(trimmed), name: trimmed }
    }
  } catch (err: any) {
    console.warn(`music-map lookup failed for "${trimmed}":`, err.message)
  }

  return null
}

/**
 * Returns autocomplete candidates. Today: at most one MA hit and one
 * music-map hit. Gives the frontend something to disambiguate against.
 */
export async function lookupAnchorCandidates(name: string): Promise<AnchorCandidate[]> {
  const trimmed = name.trim()
  if (!trimmed) return []
  const out: AnchorCandidate[] = []

  try {
    const ma = await searchArtist(trimmed)
    if (ma?.maId) {
      out.push({
        source: "ma",
        sourceId: String(ma.maId),
        name: ma.name,
        hint: [ma.genre, ma.country].filter(Boolean).join(" · ") || "Metal-Archives",
      })
    }
  } catch {}

  try {
    const similar = await getMusicMapSimilar(trimmed)
    if (similar.length > 0) {
      out.push({
        source: "musicmap",
        sourceId: musicMapSlug(trimmed),
        name: trimmed,
        hint: `music-map · ${similar.length} ähnliche Bands`,
      })
    }
  } catch {}

  return out
}
