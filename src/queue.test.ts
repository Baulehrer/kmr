import { test, expect, describe, beforeEach } from "bun:test"
import {
  enqueue,
  dequeue,
  getQueue,
  getQueueSize,
  getQueuedVideoIds,
  getRecentVideoIds,
  clearQueue,
  isDuplicate,
  isRecentArtist,
  addToHistory,
  trimRecentArtists,
  initRecentArtists,
} from "./queue"
import type { ResolvedTrack } from "./types"

function track(over: Partial<ResolvedTrack> = {}): ResolvedTrack {
  const artist = over.artist ?? "Iron Maiden"
  return {
    maId: over.maId ?? [...artist].reduce((sum, char) => sum + char.charCodeAt(0), 1),
    videoId: "v1",
    title: "T",
    artist,
    genre: "Heavy Metal",
    country: "UK",
    duration: 200,
    source: "library",
    ...over,
  }
}

beforeEach(() => {
  clearQueue()
  // Reset recent list by trimming to 0
  trimRecentArtists(0)
})

describe("queue ops", () => {
  test("enqueue and dequeue FIFO", () => {
    enqueue(track({ videoId: "a", artist: "A" }))
    enqueue(track({ videoId: "b", artist: "B" }))
    expect(getQueueSize()).toBe(2)
    expect(dequeue()?.track.videoId).toBe("a")
    expect(dequeue()?.track.videoId).toBe("b")
    expect(dequeue()).toBeUndefined()
  })

  test("getQueue returns copy", () => {
    enqueue(track())
    const q = getQueue()
    q.length = 0
    expect(getQueueSize()).toBe(1)
  })

  test("exposes queued video IDs", () => {
    enqueue(track({ videoId: "a", artist: "A" }))
    enqueue(track({ videoId: "b", artist: "B" }))
    expect(getQueuedVideoIds()).toEqual(["a", "b"])
  })
})

describe("isDuplicate", () => {
  test("detects same videoId in queue", () => {
    enqueue(track({ videoId: "x", artist: "A" }))
    expect(isDuplicate(track({ videoId: "x", artist: "B" }), 10)).toBe(true)
  })

  test("detects same artist in queue (case-insensitive)", () => {
    enqueue(track({ artist: "Iron Maiden", maId: 42 }))
    expect(isDuplicate(track({ videoId: "other", artist: "iron maiden", maId: 42 }), 10)).toBe(true)
  })

  test("not duplicate when both differ", () => {
    enqueue(track({ videoId: "x", artist: "A" }))
    expect(isDuplicate(track({ videoId: "y", artist: "B" }), 10)).toBe(false)
  })
})

describe("isRecentArtist re-ordering", () => {
  test("playing artist again moves it to the front of the recent window", () => {
    addToHistory(track({ videoId: "1", artist: "A", maId: 1 }))
    addToHistory(track({ videoId: "2", artist: "B", maId: 2 }))
    addToHistory(track({ videoId: "3", artist: "C", maId: 3 }))
    expect(isRecentArtist("A", 3, 1)).toBe(true)

    addToHistory(track({ videoId: "4", artist: "D", maId: 4 }))
    expect(isRecentArtist("A", 3, 1)).toBe(false)

    addToHistory(track({ videoId: "5", artist: "A", maId: 1 }))
    expect(isRecentArtist("A", 3, 1)).toBe(true)
  })

  test("maxRecent=0 disables protection", () => {
    addToHistory(track({ artist: "Z" }))
    expect(isRecentArtist("Z", 0)).toBe(false)
  })
})

describe("initRecentArtists", () => {
  test("restores from history without duplicates", () => {
    addToHistory(track({ videoId: "h1", artist: "X", maId: 10 }))
    addToHistory(track({ videoId: "h2", artist: "Y", maId: 11 }))
    addToHistory(track({ videoId: "h3", artist: "X", maId: 10 }))
    trimRecentArtists(0)
    initRecentArtists(10)
    expect(isRecentArtist("X", 10, 10)).toBe(true)
    expect(isRecentArtist("Y", 10, 11)).toBe(true)
  })

  test("returns recent video IDs from history", () => {
    addToHistory(track({ videoId: "rv1", artist: "RV1" }))
    addToHistory(track({ videoId: "rv2", artist: "RV2" }))
    const ids = getRecentVideoIds(100)
    expect(ids).toContain("rv1")
    expect(ids).toContain("rv2")
  })
})
