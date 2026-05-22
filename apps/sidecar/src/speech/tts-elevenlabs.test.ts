import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { synthesizeElevenLabs } from "./tts-elevenlabs.js"

const API_KEY = "test-key"

let mockFetch: ReturnType<typeof mock>
const originalFetch = globalThis.fetch

function streamingResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "content-type": "audio/mpeg" } })
}

beforeEach(() => {
  mockFetch = mock(async (_url: string, _opts: RequestInit) => {
    return streamingResponse([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])])
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.ELEVENLABS_VOICE_ID
  delete process.env.ELEVENLABS_TTS_MODEL
})

describe("synthesizeElevenLabs", () => {
  it("yields all audio chunks from the stream body", async () => {
    const out: Uint8Array[] = []
    for await (const chunk of synthesizeElevenLabs("hello", API_KEY)) {
      out.push(chunk)
    }
    expect(out).toHaveLength(2)
    expect(Array.from(out[0]!)).toEqual([1, 2, 3])
    expect(Array.from(out[1]!)).toEqual([4, 5])
  })

  it("sends POST to /text-to-speech/{voiceId}/stream with xi-api-key header", async () => {
    for await (const _ of synthesizeElevenLabs("hi", API_KEY)) { /* drain */ }
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/v1/text-to-speech/")
    expect(url).toContain("/stream")
    expect((opts.headers as Record<string, string>)["xi-api-key"]).toBe(API_KEY)
    expect(opts.method).toBe("POST")
  })

  it("uses default Rachel voice when none specified", async () => {
    for await (const _ of synthesizeElevenLabs("hi", API_KEY)) { /* drain */ }
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("21m00Tcm4TlvDq8ikWAM")
  })

  it("uses ELEVENLABS_VOICE_ID env override", async () => {
    process.env.ELEVENLABS_VOICE_ID = "custom-voice-id"
    for await (const _ of synthesizeElevenLabs("hi", API_KEY)) { /* drain */ }
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("custom-voice-id")
  })

  it("sends text and model_id in JSON body", async () => {
    for await (const _ of synthesizeElevenLabs("hello world", API_KEY)) { /* drain */ }
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.text).toBe("hello world")
    expect(body.model_id).toBe("eleven_turbo_v2")
  })

  it("throws on non-2xx response", async () => {
    globalThis.fetch = mock(async () => new Response("", { status: 429 })) as unknown as typeof fetch
    expect(async () => {
      for await (const _ of synthesizeElevenLabs("hi", API_KEY)) { /* drain */ }
    }).toThrow("ElevenLabs TTS 429")
  })
})
