import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { transcribeElevenLabs, transcribeElevenLabsFinal } from "./stt-elevenlabs.js"

const API_KEY = "test-key"
const DUMMY_WAV = new Uint8Array([82, 73, 70, 70]) // "RIFF"

let mockFetch: ReturnType<typeof mock>
const originalFetch = globalThis.fetch

beforeEach(() => {
  mockFetch = mock(async (_url: string, _opts: RequestInit) => {
    return new Response(JSON.stringify({ text: "hello world" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("transcribeElevenLabs", () => {
  it("yields one final chunk with transcribed text", async () => {
    const chunks = []
    for await (const chunk of transcribeElevenLabs(DUMMY_WAV, API_KEY)) {
      chunks.push(chunk)
    }
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: "final", text: "hello world" })
  })

  it("sends correct URL and xi-api-key header", async () => {
    for await (const _ of transcribeElevenLabs(DUMMY_WAV, API_KEY)) { /* drain */ }
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text")
    expect((opts.headers as Record<string, string>)["xi-api-key"]).toBe(API_KEY)
  })

  it("throws on non-2xx response", async () => {
    globalThis.fetch = mock(async () => new Response("", { status: 429 })) as unknown as typeof fetch
    expect(async () => {
      for await (const _ of transcribeElevenLabs(DUMMY_WAV, API_KEY)) { /* drain */ }
    }).toThrow("ElevenLabs STT 429")
  })
})

describe("transcribeElevenLabsFinal", () => {
  it("returns transcribed string", async () => {
    const text = await transcribeElevenLabsFinal(DUMMY_WAV, API_KEY)
    expect(text).toBe("hello world")
  })
})
