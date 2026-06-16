import { describe, it, expect, beforeEach, afterEach } from "bun:test"

const originalEnv = { ...process.env }
let fetchCalls: { url: string; headers: Record<string, string>; body?: unknown }[] = []

function getHeader(callIndex: number, name: string): string | undefined {
  const h = fetchCalls[callIndex]?.headers
  if (!h) return undefined
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? h[key] : undefined
}

beforeEach(() => {
  fetchCalls = []
  process.env.SIDECAR_SECRET = "test-secret"
  process.env.YOMI_BACKEND_URL = "http://test-backend:3001"
  globalThis.fetch = async (url: string, opts?: RequestInit) => {
    const headers: Record<string, string> = {}
    if (opts?.headers) {
      const h = opts.headers as Record<string, string>
      for (const k of Object.keys(h)) headers[k] = h[k]
    }
    fetchCalls.push({ url: url as string, headers, body: opts?.body })
    if (url.includes("/api/stt")) {
      return new Response(JSON.stringify({ text: "hello from stt proxy" }), { status: 200 })
    }
    if (url.includes("/api/tts")) {
      return new Response(new Blob(["fake-mp3"]), { status: 200, headers: { "content-type": "audio/mpeg" } })
    }
    return new Response("not found", { status: 404 })
  }
})

afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof globalThis.fetch
  process.env = { ...originalEnv }
})

describe("elevenLabsTranscribe (STT via proxy)", () => {
  it("calls backend STT proxy with sidecar secret", async () => {
    const { elevenLabsTranscribe } = await import("./stt.js")
    const result = await elevenLabsTranscribe(new Uint8Array(100))
    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0]!.url).toBe("http://test-backend:3001/api/stt")
    expect(getHeader(0, "x-sidecar-secret")).toBe("test-secret")
    expect(result.text).toBe("hello from stt proxy")
  })

  it("sends Authorization Bearer token when SIDECAR_SECRET is absent", async () => {
    delete process.env.SIDECAR_SECRET
    process.env.YOMI_SESSION_TOKEN = "test-session-token"
    const { elevenLabsTranscribe } = await import("./stt.js")
    await elevenLabsTranscribe(new Uint8Array(100))
    expect(getHeader(0, "Authorization")).toBe("Bearer test-session-token")
    expect(getHeader(0, "x-sidecar-secret")).toBeUndefined()
  })

  it("throws on proxy error", async () => {
    globalThis.fetch = async () => new Response("bad request", { status: 400 })
    const { elevenLabsTranscribe } = await import("./stt.js")
    await expect(elevenLabsTranscribe(new Uint8Array(100))).rejects.toThrow("STT proxy failed")
  })

  it("throws when proxy returns no transcript", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ text: "" }), { status: 200 })
    const { elevenLabsTranscribe } = await import("./stt.js")
    await expect(elevenLabsTranscribe(new Uint8Array(100))).rejects.toThrow("no transcript")
  })
})

describe("elevenLabsSynthesize (TTS via proxy)", () => {
  it("calls backend TTS proxy with sidecar secret and correct body", async () => {
    const { elevenLabsSynthesize } = await import("./tts.js")
    const chunks: Uint8Array[] = []
    for await (const chunk of elevenLabsSynthesize("hello world")) {
      chunks.push(chunk)
    }
    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0]!.url).toBe("http://test-backend:3001/api/tts")
    expect(getHeader(0, "x-sidecar-secret")).toBe("test-secret")
    expect(getHeader(0, "content-type")).toBe("application/json")
    const body = JSON.parse(fetchCalls[0]!.body as string) as Record<string, unknown>
    expect(body.text).toBe("hello world")
    expect(body.voice_id).toBe("EXAVITQu4vr4xnSDxMaL")
    expect(body.model_id).toBe("eleven_flash_v2_5")
    expect(chunks.length).toBe(1)
  })

  it("sends Authorization Bearer token when SIDECAR_SECRET is absent", async () => {
    delete process.env.SIDECAR_SECRET
    process.env.YOMI_SESSION_TOKEN = "test-session-token"
    const { elevenLabsSynthesize } = await import("./tts.js")
    const chunks: Uint8Array[] = []
    for await (const chunk of elevenLabsSynthesize("hello world")) {
      chunks.push(chunk)
    }
    expect(getHeader(0, "Authorization")).toBe("Bearer test-session-token")
    expect(getHeader(0, "x-sidecar-secret")).toBeUndefined()
  })

  it("throws on proxy error", async () => {
    globalThis.fetch = async () => new Response("bad request", { status: 400 })
    const { elevenLabsSynthesize } = await import("./tts.js")
    const gen = elevenLabsSynthesize("hello")
    await expect(gen.next()).rejects.toThrow("TTS proxy failed")
  })
})
