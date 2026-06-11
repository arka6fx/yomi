import { describe, it, expect, beforeEach } from "bun:test"
import { resolveTts } from "./resolver.js"

beforeEach(() => {
  delete process.env.TTS_ENGINE
  delete process.env.AWS_ACCESS_KEY_ID
  delete process.env.AWS_SECRET_ACCESS_KEY
})

describe("resolveTts", () => {
  it("returns none when no API key and no override", () => {
    expect(resolveTts()).toBe("none")
  })

  it("returns nova-sonic when AWS Bedrock credentials are set", () => {
    process.env.AWS_ACCESS_KEY_ID = "test-access"
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret"
    expect(resolveTts()).toBe("nova-sonic")
  })

  it("TTS_ENGINE=none disables TTS even with key", () => {
    process.env.AWS_ACCESS_KEY_ID = "test-access"
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret"
    process.env.TTS_ENGINE = "none"
    expect(resolveTts()).toBe("none")
  })

  it("TTS_ENGINE=nova-sonic is honoured", () => {
    process.env.TTS_ENGINE = "nova-sonic"
    expect(resolveTts()).toBe("nova-sonic")
  })
})
