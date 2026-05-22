import { describe, it, expect, beforeEach } from "bun:test"
import { resolveTts } from "./resolver.js"

beforeEach(() => {
  delete process.env.TTS_ENGINE
  delete process.env.ELEVENLABS_API_KEY
})

describe("resolveTts", () => {
  it("returns piper when no env is set", () => {
    expect(resolveTts()).toBe("piper")
  })

  it("returns elevenlabs when ELEVENLABS_API_KEY is set", () => {
    process.env.ELEVENLABS_API_KEY = "sk-test"
    expect(resolveTts()).toBe("elevenlabs")
  })

  it("TTS_ENGINE override wins over ELEVENLABS_API_KEY", () => {
    process.env.ELEVENLABS_API_KEY = "sk-test"
    process.env.TTS_ENGINE = "piper"
    expect(resolveTts()).toBe("piper")
  })

  it("TTS_ENGINE=edge-tts is honoured", () => {
    process.env.TTS_ENGINE = "edge-tts"
    expect(resolveTts()).toBe("edge-tts")
  })

  it("TTS_ENGINE=none disables TTS", () => {
    process.env.ELEVENLABS_API_KEY = "sk-test"
    process.env.TTS_ENGINE = "none"
    expect(resolveTts()).toBe("none")
  })

  it("TTS_ENGINE is case-insensitive", () => {
    process.env.TTS_ENGINE = "ELEVENLABS"
    process.env.ELEVENLABS_API_KEY = "sk-test"
    expect(resolveTts()).toBe("elevenlabs")
  })

  it("unknown TTS_ENGINE value falls through to default selection", () => {
    process.env.TTS_ENGINE = "bogus"
    process.env.ELEVENLABS_API_KEY = "sk-test"
    expect(resolveTts()).toBe("elevenlabs")
  })
})
