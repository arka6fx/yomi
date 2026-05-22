import { whisperMock } from "./__test-mocks.js"
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { transcribe, transcribeStreaming } from "./transcribe.js"

const DUMMY_WAV = new Uint8Array(44)
const originalFetch = globalThis.fetch

let fetchImpl: (url: string, opts: RequestInit) => Promise<Response> = async () =>
  new Response(JSON.stringify({ text: "elevenlabs text" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

beforeEach(() => {
  whisperMock.reset()
  whisperMock.result = "whisper text"
  delete process.env.ELEVENLABS_API_KEY
  fetchImpl = async () =>
    new Response(JSON.stringify({ text: "elevenlabs text" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  globalThis.fetch = mock(async (url: string, opts: RequestInit) =>
    fetchImpl(url, opts),
  ) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("transcribe", () => {
  it("uses ElevenLabs when ELEVENLABS_API_KEY is set", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key"
    const text = await transcribe(DUMMY_WAV)
    expect(text).toBe("elevenlabs text")
  })

  it("uses Whisper when no API key is set", async () => {
    const text = await transcribe(DUMMY_WAV)
    expect(text).toBe("whisper text")
  })

  it("falls back to Whisper when ElevenLabs throws", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key"
    fetchImpl = async () => new Response("", { status: 500 })
    const text = await transcribe(DUMMY_WAV)
    expect(text).toBe("whisper text")
  })
})

describe("transcribeStreaming", () => {
  it("yields ElevenLabs final chunk when key is set", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key"
    const chunks = []
    for await (const c of transcribeStreaming(DUMMY_WAV)) chunks.push(c)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: "final", text: "elevenlabs text" })
  })

  it("yields whisper chunk when no key", async () => {
    const chunks = []
    for await (const c of transcribeStreaming(DUMMY_WAV)) chunks.push(c)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: "final", text: "whisper text" })
  })

  it("falls back to whisper chunk when ElevenLabs throws", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key"
    fetchImpl = async () => new Response("", { status: 500 })
    const chunks = []
    for await (const c of transcribeStreaming(DUMMY_WAV)) chunks.push(c)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: "final", text: "whisper text" })
  })
})
