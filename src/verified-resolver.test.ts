import { describe, expect, test } from "bun:test"
import { collectVerifiedChannels } from "./verified-resolver"
import type { MATrack, YTVideo } from "./types"

function track(title: string, duration = 240): MATrack {
  return { maId: 393, albumId: 1, album: "Psalm 9", title, duration }
}

function video(videoId: string, title: string, channelId: string): YTVideo {
  return { videoId, title, channelId, channelName: "Trouble - Topic", duration: 240 }
}

describe("verified MA channel evidence", () => {
  test("requires two distinct discography tracks on the same channel", () => {
    const channels = collectVerifiedChannels([
      { track: track("Psalm 9"), videos: [video("doom-1", "Psalm 9", "doom-channel")] },
      { track: track("The Tempter"), videos: [video("doom-2", "The Tempter", "doom-channel")] },
      { track: track("Psalm 9"), videos: [video("rap-1", "Psalm 9", "rap-channel")] },
    ])

    expect([...channels.keys()]).toEqual(["doom-channel"])
    expect(channels.get("doom-channel")?.trackKeys.size).toBe(2)
  })

  test("does not count duplicate uploads of one track as separate evidence", () => {
    const channels = collectVerifiedChannels([
      {
        track: track("Psalm 9"),
        videos: [
          video("upload-1", "Psalm 9", "same-channel"),
          video("upload-2", "Psalm 9 remastered", "same-channel"),
        ],
      },
    ])

    expect(channels.size).toBe(0)
  })

  test("keeps unrelated titles out of the evidence set", () => {
    const channels = collectVerifiedChannels([
      { track: track("Psalm 9"), videos: [video("doom-1", "Psalm 9", "doom-channel")] },
      { track: track("The Tempter"), videos: [video("doom-2", "The Tempter", "doom-channel")] },
    ])

    expect(channels.get("doom-channel")?.trackKeys.has("f i g h t")).toBe(false)
  })
})
