import { describe, expect, test } from "bun:test"
import { activeLyricIndex, parseLrc } from "./lyrics"

describe("LRC lyrics", () => {
  test("parses, offsets and sorts timestamped lines", () => {
    const lines = parseLrc("[offset:250]\n[00:02.50]Second\n[00:01.00][00:03.000]First")
    expect(lines).toEqual([
      { startMs: 1250, text: "First" },
      { startMs: 2750, text: "Second" },
      { startMs: 3250, text: "First" },
    ])
  })

  test("represents instrumental gaps and strips enhanced word stamps", () => {
    expect(parseLrc("[00:01.00]<00:01.00>Hello <00:01.50>world\n[00:04.00]")).toEqual([
      { startMs: 1000, text: "Hello world" },
      { startMs: 4000, text: "♪" },
    ])
  })

  test("finds the active line before and after seeking", () => {
    const lines = parseLrc("[00:01]One\n[00:03]Two\n[00:05]Three")
    expect(activeLyricIndex(lines, 500)).toBe(-1)
    expect(activeLyricIndex(lines, 3500)).toBe(1)
    expect(activeLyricIndex(lines, 5000)).toBe(2)
  })
})
