import { describe, expect, test } from "bun:test"
import { getMultiplier, recordDislike, recordLike } from "./feedback"

describe("gentle artist feedback", () => {
  test("likes and dislikes only nudge future selection weights", () => {
    const artist = "Feedback Test Band"
    const maId = 990010
    expect(getMultiplier(artist, maId)).toBe(1)
    recordLike(artist, maId)
    expect(getMultiplier(artist, maId)).toBeCloseTo(1.04)
    recordDislike(artist, maId)
    expect(getMultiplier(artist, maId)).toBeCloseTo(0.98)
  })
})
