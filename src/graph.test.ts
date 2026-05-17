import { test, expect, describe } from "bun:test"
import { bfsNeighborhood, type NeighborLookup } from "./graph"

function adjacency(edges: Record<number, Array<{ id: number; score: number }>>): NeighborLookup {
  return (id: number) => edges[id] ?? []
}

describe("bfsNeighborhood", () => {
  test("returns empty when anchor has no neighbors", () => {
    const result = bfsNeighborhood(1, 2, adjacency({}))
    expect(result.size).toBe(0)
  })

  test("returns direct neighbors at hop=1", () => {
    const edges = {
      1: [{ id: 2, score: 80 }, { id: 3, score: 60 }],
    }
    const result = bfsNeighborhood(1, 1, adjacency(edges))
    expect(result.size).toBe(2)
    expect(result.get(2)?.hops).toBe(1)
    expect(result.get(3)?.hops).toBe(1)
    expect(result.get(2)?.aggregateScore).toBeCloseTo(0.8)
    expect(result.get(3)?.aggregateScore).toBeCloseTo(0.6)
  })

  test("does not include 2nd-hop neighbors when maxHops=1", () => {
    const edges = {
      1: [{ id: 2, score: 80 }],
      2: [{ id: 3, score: 90 }],
    }
    const result = bfsNeighborhood(1, 1, adjacency(edges))
    expect(result.has(2)).toBe(true)
    expect(result.has(3)).toBe(false)
  })

  test("expands to 2 hops with multiplicative path score", () => {
    const edges = {
      1: [{ id: 2, score: 80 }],
      2: [{ id: 3, score: 50 }],
    }
    const result = bfsNeighborhood(1, 2, adjacency(edges))
    expect(result.get(3)?.hops).toBe(2)
    expect(result.get(3)?.aggregateScore).toBeCloseTo(0.8 * 0.5)
  })

  test("keeps minimum hop distance when reachable via multiple paths", () => {
    const edges = {
      1: [{ id: 2, score: 50 }, { id: 3, score: 100 }],
      3: [{ id: 2, score: 100 }],
    }
    const result = bfsNeighborhood(1, 2, adjacency(edges))
    expect(result.get(2)?.hops).toBe(1)
  })

  test("excludes the anchor itself from the result", () => {
    const edges = {
      1: [{ id: 2, score: 80 }],
      2: [{ id: 1, score: 80 }],
    }
    const result = bfsNeighborhood(1, 2, adjacency(edges))
    expect(result.has(1)).toBe(false)
    expect(result.has(2)).toBe(true)
  })

  test("respects maxHops=3 boundary", () => {
    const edges = {
      1: [{ id: 2, score: 100 }],
      2: [{ id: 3, score: 100 }],
      3: [{ id: 4, score: 100 }],
      4: [{ id: 5, score: 100 }],
    }
    const result = bfsNeighborhood(1, 3, adjacency(edges))
    expect(result.has(2)).toBe(true)
    expect(result.has(3)).toBe(true)
    expect(result.has(4)).toBe(true)
    expect(result.has(5)).toBe(false)
  })

  test("clamps negative or zero scores to a floor", () => {
    const edges = {
      1: [{ id: 2, score: 0 }],
    }
    const result = bfsNeighborhood(1, 1, adjacency(edges))
    expect(result.get(2)?.aggregateScore).toBeGreaterThan(0)
  })

  test("picks best of two paths to the same node at same hop distance", () => {
    const edges = {
      1: [{ id: 2, score: 50 }, { id: 3, score: 50 }],
      2: [{ id: 4, score: 90 }],
      3: [{ id: 4, score: 10 }],
    }
    const result = bfsNeighborhood(1, 2, adjacency(edges))
    expect(result.get(4)?.aggregateScore).toBeCloseTo(0.5 * 0.9)
  })
})
