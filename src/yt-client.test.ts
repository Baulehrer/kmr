import { test, expect, describe } from "bun:test"
import { parseDuration, pickBestVideo, scoreVideo } from "./yt-client"

function video(id: string, title: string, channelName: string, duration = "4:20") {
  return {
    id,
    title: { text: title },
    author: { name: channelName },
    duration: { text: duration },
  }
}

describe("parseDuration", () => {
  test("parses mm:ss and hh:mm:ss", () => {
    expect(parseDuration("4:20")).toBe(260)
    expect(parseDuration("1:02:03")).toBe(3723)
  })

  test("rejects invalid values", () => {
    expect(parseDuration("live")).toBe(0)
    expect(parseDuration()).toBe(0)
  })
})

describe("YouTube video scoring", () => {
  test("prefers official topic/audio matches", () => {
    const picked = pickBestVideo([
      video("weak", "Iron Maiden random upload", "Some Channel"),
      video("topic", "Iron Maiden - The Trooper", "iron maiden - topic"),
    ], "Iron Maiden")

    expect(picked?.videoId).toBe("topic")
  })

  test("skips excluded video IDs", () => {
    const picked = pickBestVideo([
      video("topic", "Iron Maiden - The Trooper", "Iron Maiden - Topic"),
      video("audio", "Iron Maiden - Aces High official audio", "Iron Maiden"),
    ], "Iron Maiden", { excludeVideoIds: ["topic"] })

    expect(picked?.videoId).toBe("audio")
  })

  test("does not return disqualified non-music fallbacks", () => {
    const picked = pickBestVideo([
      video("interview", "Iron Maiden interview 1984", "Archive"),
      video("reaction", "First time hearing Iron Maiden", "Reaction Channel"),
    ], "Iron Maiden")

    expect(picked).toBeNull()
  })

  test("scores non-artist results as invalid", () => {
    expect(scoreVideo("Black Sabbath - War Pigs", "Black Sabbath - Topic", "Iron Maiden")).toBeLessThan(0)
  })
})
