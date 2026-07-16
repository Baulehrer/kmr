import { describe, expect, test } from "bun:test"
import { blockTrack, getBlockedVideoIds, isTrackBlocked } from "./track-blocks"

describe("blocked tracks", () => {
  test("permanently excludes a precise video identity", () => {
    const videoId = `blocked-${Date.now()}`
    expect(isTrackBlocked(videoId)).toBe(false)
    blockTrack({ maId: 393, videoId, title: "Psalm 9", artist: "Trouble", genre: "Doom Metal", country: "United States", duration: 300, source: "library" })
    expect(isTrackBlocked(videoId)).toBe(true)
    expect(getBlockedVideoIds()).toContain(videoId)
  })
})
