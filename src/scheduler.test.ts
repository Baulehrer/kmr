import { test, expect, describe } from "bun:test"
import { chooseBandSource, getArtistFocus, markPlaying, startArtistFocus, stopArtistFocus } from "./scheduler"
import type { ResolvedTrack } from "./types"

describe("chooseBandSource", () => {
  test("honors hard endpoints", () => {
    expect(chooseBandSource(0, [], 10)).toBe("similar")
    expect(chooseBandSource(100, ["similar", "similar"], 10)).toBe("anchor")
  })

  test("keeps a 50 percent anchor target balanced", () => {
    const recent: Array<"anchor" | "similar"> = []
    for (let i = 0; i < 10; i++) {
      recent.push(chooseBandSource(50, recent, 10))
    }

    expect(recent.filter((pick) => pick === "anchor")).toHaveLength(5)
    expect(recent.filter((pick) => pick === "similar")).toHaveLength(5)
  })

  test("keeps a 25 percent anchor target near one in four", () => {
    const recent: Array<"anchor" | "similar"> = []
    for (let i = 0; i < 8; i++) {
      recent.push(chooseBandSource(25, recent, 8))
    }

    expect(recent.filter((pick) => pick === "anchor")).toHaveLength(2)
    expect(recent.filter((pick) => pick === "similar")).toHaveLength(6)
  })
})

describe("artist focus", () => {
  const current: ResolvedTrack = {
    maId: 393,
    videoId: "trouble-1",
    title: "Psalm 9",
    albumId: 2462,
    album: "The Skull",
    artist: "Trouble",
    genre: "Doom Metal",
    country: "United States",
    duration: 300,
    source: "library",
  }

  test("only activates for the unchanged verified current track", () => {
    stopArtistFocus()
    markPlaying(current, false)
    expect(startArtistFocus(15210, current.videoId)).toBeNull()
    expect(startArtistFocus(current.maId, "stale-video")).toBeNull()
    expect(startArtistFocus(current.maId, current.videoId)).toEqual({ maId: 393, name: "Trouble" })
    expect(getArtistFocus()).toEqual({ maId: 393, name: "Trouble" })
    stopArtistFocus()
    expect(getArtistFocus()).toBeNull()
  })
})
