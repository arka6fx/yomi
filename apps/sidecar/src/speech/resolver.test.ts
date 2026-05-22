import { describe, it, expect, beforeEach } from "bun:test"
import { resolveTts } from "./resolver.js"

beforeEach(() => {
  delete process.env.TTS_ENGINE
  delete process.env.OPENAI_API_KEY
})

describe("resolveTts", () => {
  it("returns none when no API key and no override", () => {
    expect(resolveTts()).toBe("none")
  })

  it("returns openai when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test"
    expect(resolveTts()).toBe("openai")
  })

  it("TTS_ENGINE=none disables TTS even with key", () => {
    process.env.OPENAI_API_KEY = "sk-test"
    process.env.TTS_ENGINE = "none"
    expect(resolveTts()).toBe("none")
  })

  it("TTS_ENGINE=openai is honoured", () => {
    process.env.TTS_ENGINE = "openai"
    expect(resolveTts()).toBe("openai")
  })
})
