import { test, expect, describe } from "bun:test"
import { chooseBandSource } from "./scheduler"

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
