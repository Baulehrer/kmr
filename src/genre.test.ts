import { test, expect, describe } from "bun:test"
import { parseGenre, matchesGenre, normalizeName, parseDecade, matchesDecade } from "./genre"

describe("parseGenre", () => {
  test("splits on slash", () => {
    expect(parseGenre("Heavy Metal/Power Metal")).toEqual(["Heavy Metal", "Power Metal"])
  })

  test("splits on comma", () => {
    expect(parseGenre("Black Metal, Doom Metal")).toEqual(["Black Metal", "Doom Metal"])
  })

  test("trims and drops empties", () => {
    expect(parseGenre("  Heavy Metal /  / Power Metal ")).toEqual(["Heavy Metal", "Power Metal"])
  })

  test("empty input → empty array", () => {
    expect(parseGenre("")).toEqual([])
    expect(parseGenre(undefined as any)).toEqual([])
  })
})

describe("matchesGenre", () => {
  test("substring match on string input", () => {
    expect(matchesGenre("Heavy Metal/Power Metal", "Power")).toBe(true)
  })

  test("substring match on array input", () => {
    expect(matchesGenre(["Heavy Metal", "Power Metal"], "power")).toBe(true)
  })

  test("no match", () => {
    expect(matchesGenre("Heavy Metal", "Jazz")).toBe(false)
  })

  test("empty target → match all", () => {
    expect(matchesGenre("anything", "")).toBe(true)
  })

  test("matches raw genres against canonical composite targets", () => {
    expect(matchesGenre("Doom Metal", "Doom/Stoner/Sludge")).toBe(true)
    expect(matchesGenre("Industrial Metal", "Electronic/Industrial")).toBe(true)
    expect(matchesGenre("Melodic Metalcore", "Metalcore/Deathcore")).toBe(true)
  })
})

describe("normalizeName", () => {
  test("lowercases and trims", () => {
    expect(normalizeName("  Iron Maiden  ")).toBe("iron maiden")
  })
})

describe("parseDecade", () => {
  test("extracts decade from a 4-digit year", () => {
    expect(parseDecade("1981")).toBe("80s")
    expect(parseDecade("1975")).toBe("70s")
    expect(parseDecade("1990")).toBe("90s")
    expect(parseDecade("2000")).toBe("00s")
    expect(parseDecade("2015")).toBe("10s")
    expect(parseDecade("2023")).toBe("20s")
  })

  test("finds year embedded in a sentence", () => {
    expect(parseDecade("Formed in 1985")).toBe("80s")
  })

  test("treats pre-1980 as 70s bucket", () => {
    expect(parseDecade("1968")).toBe("70s")
  })

  test("returns null on missing / unparseable input", () => {
    expect(parseDecade(null)).toBeNull()
    expect(parseDecade("")).toBeNull()
    expect(parseDecade("unknown")).toBeNull()
    expect(parseDecade(undefined)).toBeNull()
  })

  test("rejects implausible years", () => {
    expect(parseDecade("1850")).toBeNull()
    expect(parseDecade("2150")).toBeNull()
  })
})

describe("matchesDecade", () => {
  test("empty wanted list → match all (including null decade)", () => {
    expect(matchesDecade("80s", [])).toBe(true)
    expect(matchesDecade(null, [])).toBe(true)
  })

  test("null decade fails any specific filter", () => {
    expect(matchesDecade(null, ["80s"])).toBe(false)
  })

  test("matches when decade is in wanted set", () => {
    expect(matchesDecade("80s", ["80s", "90s"])).toBe(true)
  })

  test("rejects when decade is outside wanted set", () => {
    expect(matchesDecade("70s", ["80s", "90s"])).toBe(false)
  })
})
