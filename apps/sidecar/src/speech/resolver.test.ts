import { describe, it, expect, beforeEach } from "bun:test"
import { resolveTts } from "./resolver.js"

beforeEach(() => {
  delete process.env.TTS_ENGINE
  delete process.env.ELEVENLABS_API_KEY
})

describe("resolveTts", () => {
  it("returns none when no API key and no override", () => {
    expect(resolveTts()).toBe("none")
  })

  it("returns elevenlabs when ELEVENLABS_API_KEY is set", () => {
    process.env.ELEVENLABS_API_KEY = "sk-test"
    expect(resolveTts()).toBe("elevenlabs")
  })

  it("TTS_ENGINE=none disables TTS even with key", () => {
    process.env.ELEVENLABS_API_KEY = "sk-test"
    process.env.TTS_ENGINE = "none"
    expect(resolveTts()).toBe("none")
  })

  it("TTS_ENGINE=elevenlabs is honoured", () => {
    process.env.TTS_ENGINE = "elevenlabs"
    expect(resolveTts()).toBe("elevenlabs")
  })
})
