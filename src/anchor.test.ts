import { describe, expect, test } from "bun:test"
import { exactArtistMatches } from "./anchor"
import type { MASearchResult } from "./types"

const candidates: MASearchResult[] = [
  { maId: 15210, name: "Trouble", genre: "Heavy Metal", country: "Sweden", formedIn: "1982" },
  { maId: 393, name: "Trouble", genre: "Doom Metal", country: "United States", formedIn: "1978" },
  { maId: 3540552359, name: "Troubletrace", genre: "Metalcore", country: "Russia", formedIn: "2010" },
]

describe("Metal Archives namesake selection", () => {
  test("keeps both exact Trouble identities and drops fuzzy names", () => {
    expect(exactArtistMatches("Trouble", candidates).map((artist) => artist.maId)).toEqual([15210, 393])
  })

  test("matches case-insensitively without silently choosing one", () => {
    expect(exactArtistMatches(" trouble ", candidates)).toHaveLength(2)
  })
})
