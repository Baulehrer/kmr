import { describe, expect, test } from "bun:test"
import { getDiscographyTracks, parseAdapterOutput, releaseTypeGroup } from "./ma-client"
import db from "./db"

describe("parseAdapterOutput", () => {
  test("accepts dependency logs before the adapter response", () => {
    const result = parseAdapterOutput('INFO Scrapling cache ready\n{"status":200,"parsed":[]}\n')
    expect(result).toEqual({ status: 200, parsed: [] })
  })

  test("uses the final JSON response", () => {
    const result = parseAdapterOutput('{"progress":1}\n{"status":200,"parsed":["Trouble"]}')
    expect(result.parsed).toEqual(["Trouble"])
  })

  test("rejects output without JSON", () => {
    expect(() => parseAdapterOutput("INFO only")).toThrow("no JSON object found")
  })
})

describe("releaseTypeGroup", () => {
  test("maps Metal Archives release labels to stable filters", () => {
    expect(releaseTypeGroup("Full-length")).toBe("studio")
    expect(releaseTypeGroup("EP")).toBe("ep")
    expect(releaseTypeGroup("Live album")).toBe("live")
    expect(releaseTypeGroup("Demo")).toBe("demo")
    expect(releaseTypeGroup("Single")).toBe("single")
    expect(releaseTypeGroup("Compilation")).toBe("other")
  })
})

describe("discography filters", () => {
  test("uses the album release year for decade selection", async () => {
    const maId = 9_900_001
    db.run("INSERT INTO ma_search_cache (name_key, fetched_at) VALUES (?, ?)", [`discography:${maId}`, Date.now()])
    db.run("INSERT INTO ma_releases (ma_id, album_id, title, release_type, release_year, tracks_fetched_at) VALUES (?, 1, 'Old', 'Full-length', '1985', ?)", [maId, Date.now()])
    db.run("INSERT INTO ma_releases (ma_id, album_id, title, release_type, release_year, tracks_fetched_at) VALUES (?, 2, 'New', 'Full-length', '2012', ?)", [maId, Date.now()])
    db.run("INSERT INTO ma_tracks (ma_id, album_id, album_title, title, title_key, duration) VALUES (?, 1, 'Old', 'Eighties Song', 'eighties song', 240)", [maId])
    db.run("INSERT INTO ma_tracks (ma_id, album_id, album_title, title, title_key, duration) VALUES (?, 2, 'New', 'Modern Song', 'modern song', 240)", [maId])
    const tracks = await getDiscographyTracks(maId, 1, 0, ["studio"], ["80s"])
    expect(tracks.map((track) => track.title)).toEqual(["Eighties Song"])
    expect(tracks[0]?.releaseYear).toBe("1985")
  })
})
