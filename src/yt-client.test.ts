import { test, expect, describe } from "bun:test"
import { parseDuration, pickBestVideo, scoreVideo } from "./yt-client"

function video(id: string, title: string, channelName: string, duration = "4:20") {
  return {
    id,
    title: { text: title },
    author: { name: channelName, id: `channel-${id}` },
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

  test("accepts topic channel matches even when the title omits the artist", () => {
    const picked = pickBestVideo([
      video("topic", "Stargazer", "Rainbow - Topic"),
    ], "Rainbow")

    expect(picked?.videoId).toBe("topic")
  })

  test("accepts label uploads when the title credits the artist first", () => {
    const picked = pickBestVideo([
      video("label", "Rainbow - Since You Been Gone (Official Video)", "Universal Music"),
    ], "Rainbow")

    expect(picked?.videoId).toBe("label")
  })

  test("rejects song-title traps for common artist names", () => {
    const picked = pickBestVideo([
      video("pop", "Kacey Musgraves - Rainbow (Official Music Video)", "KaceyMusgravesVEVO"),
      video("real", "Rainbow - Stargazer", "Rainbow - Topic"),
    ], "Rainbow")

    expect(picked?.videoId).toBe("real")
    expect(scoreVideo("Kacey Musgraves - Rainbow (Official Music Video)", "KaceyMusgravesVEVO", "Rainbow")).toBeLessThan(0)
  })

  test("rejects generic genre matches for one-word artists", () => {
    expect(scoreVideo("Death Metal Compilation", "Metal Archive", "Death")).toBeLessThan(0)
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

  test("rejects covers and compilation results", () => {
    const picked = pickBestVideo([
      video("cover", "Rainbow - Stargazer guitar cover", "Some Channel"),
      video("compilation", "Rainbow greatest hits compilation", "Archive"),
    ], "Rainbow")

    expect(picked).toBeNull()
  })

  test("does not treat artist names containing blocked words as blocked keywords", () => {
    expect(scoreVideo("Whitesnake - Here I Go Again", "David Coverdale", "Whitesnake")).toBeGreaterThan(0)
  })

  test("scores non-artist results as invalid", () => {
    expect(scoreVideo("Black Sabbath - War Pigs", "Black Sabbath - Topic", "Iron Maiden")).toBeLessThan(0)
  })

  test("requires the selected MA track title, duration and verified channel", () => {
    const picked = pickBestVideo([
      video("wrong-title", "F.I.G.H.T.", "Trouble - Topic", "4:00"),
      video("wrong-channel", "Trouble - The Tempter", "Other Trouble", "6:39"),
      video("correct", "The Tempter", "Trouble - Topic", "6:39"),
    ], "Trouble", {
      expectedTitle: "The Tempter",
      expectedDuration: 399,
      allowedChannelIds: ["channel-correct"],
    })

    expect(picked?.videoId).toBe("correct")
  })
})
