import { describe, expect, it } from "bun:test"
import { spotifyAgent } from "./spotify.js"
import type { UiaPort } from "../providers/types.js"

function fakeUia(window: string | null): UiaPort {
  return {
    findWindow: async () => (window === null ? null : 42),
    getWindowInfo: async () => ({ window: window ?? "" }),
  }
}

function validate(uia: UiaPort) {
  return spotifyAgent.validate({ goal: "play lofi on spotify", lastError: null, uia })
}

describe("spotifyAgent.validate", () => {
  it("passes when a track is showing in the window title", async () => {
    expect(await validate(fakeUia("Tycho - A Walk"))).toBe("pass")
  })

  it("fails when Spotify is not running at all", async () => {
    expect(await validate(fakeUia(null))).toBe("fail")
  })

  it("is inconclusive when Spotify is open but idle", async () => {
    expect(await validate(fakeUia("Spotify"))).toBe("inconclusive")
    expect(await validate(fakeUia("Spotify Premium"))).toBe("inconclusive")
  })

  it("is inconclusive when the helper is unreachable", async () => {
    const throwing: UiaPort = {
      findWindow: async () => {
        throw new Error("uia-helper exited")
      },
      getWindowInfo: async () => ({ window: "" }),
    }
    expect(await validate(throwing)).toBe("inconclusive")
  })
})
