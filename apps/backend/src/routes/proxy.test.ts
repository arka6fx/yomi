import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { Hono } from "hono"

let mockAuthSession: { user: { id: string }; session: { id: string } } | null = { user: { id: "test-user" }, session: { id: "test-session" } }

mock.module("../auth.js", () => ({
  getAuth: () => ({
    api: {
      getSession: async () => mockAuthSession,
    },
  }),
}))

const originalEnv = { ...process.env }
let elevenlabsCalls: { url: string; headers: Record<string, string>; body?: unknown }[] = []

function mockElevenLabs(status: number, responseBody: unknown, contentType = "application/json") {
  globalThis.fetch = async (url: string, opts?: RequestInit) => {
    const headers: Record<string, string> = {}
    if (opts?.headers) {
      const h = opts.headers as Record<string, string>
      for (const k of Object.keys(h)) headers[k] = h[k]
    }
    elevenlabsCalls.push({ url, headers, body: opts?.body })
    return new Response(
      typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody),
      { status, headers: { "content-type": contentType } },
    )
  }
}

beforeEach(() => {
  elevenlabsCalls = []
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key"
  process.env.SIDECAR_SECRET = "test-sidecar-secret"
  mockAuthSession = null
})

afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof globalThis.fetch
  process.env = { ...originalEnv }
})

// ── STT proxy ──────────────────────────────────────────────────────────────

describe("POST /api/stt (STT proxy)", () => {
  it("requires x-sidecar-secret when SIDECAR_SECRET is set", async () => {
    const { sttRouter } = await import("./stt.js")
    const app = new Hono().route("/api/stt", sttRouter)
    const res = await app.request("/api/stt", { method: "POST" })
    expect(res.status).toBe(401)
  })

  it("rejects wrong sidecar secret", async () => {
    const { sttRouter } = await import("./stt.js")
    const app = new Hono().route("/api/stt", sttRouter)
    const res = await app.request("/api/stt", {
      method: "POST",
      headers: { "x-sidecar-secret": "wrong-secret" },
    })
    expect(res.status).toBe(401)
  })

  it("rejects missing ELEVENLABS_API_KEY", async () => {
    delete process.env.ELEVENLABS_API_KEY
    const { sttRouter } = await import("./stt.js")
    const app = new Hono().route("/api/stt", sttRouter)
    const res = await app.request("/api/stt", {
      method: "POST",
      headers: { "x-sidecar-secret": "test-sidecar-secret" },
    })
    expect(res.status).toBe(500)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain("ELEVENLABS_API_KEY")
  })

  it("rejects missing file field", async () => {
    const { sttRouter } = await import("./stt.js")
    const app = new Hono().route("/api/stt", sttRouter)
    const res = await app.request("/api/stt", {
      method: "POST",
      headers: { "x-sidecar-secret": "test-sidecar-secret" },
    })
    expect(res.status).toBe(400)
  })

  it("forwards request to ElevenLabs and returns transcription", async () => {
    mockElevenLabs(200, { text: "hello world" })

    const { sttRouter } = await import("./stt.js")
    const app = new Hono().route("/api/stt", sttRouter)

    const form = new FormData()
    form.set("file", new Blob(["fake audio data"], { type: "audio/wav" }), "test.wav")
    form.set("model_id", "scribe_v2")

    const res = await app.request("/api/stt", {
      method: "POST",
      headers: { "x-sidecar-secret": "test-sidecar-secret" },
      body: form,
    })

    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json.text).toBe("hello world")

    // Verify ElevenLabs was called with the API key
    expect(elevenlabsCalls.length).toBe(1)
    expect(elevenlabsCalls[0]!.url).toContain("api.elevenlabs.io/v1/speech-to-text")
    expect(elevenlabsCalls[0]!.headers["xi-api-key"]).toBe("test-elevenlabs-key")
  })

  it("forwards upstream STT errors", async () => {
    mockElevenLabs(401, { detail: "Invalid API key" })

    const { sttRouter } = await import("./stt.js")
    const app = new Hono().route("/api/stt", sttRouter)

    const form = new FormData()
    form.set("file", new Blob(["bad data"]), "test.wav")

    const res = await app.request("/api/stt", {
      method: "POST",
      headers: { "x-sidecar-secret": "test-sidecar-secret" },
      body: form,
    })

    expect(res.status).toBe(401)
    const json = await res.json() as Record<string, unknown>
    expect(json.error).toContain("ElevenLabs STT failed")
  })

  it("accepts Authorization Bearer token instead of sidecar secret", async () => {
    mockElevenLabs(200, { text: "bearer auth works" })
    mockAuthSession = { user: { id: "test-user" }, session: { id: "test-session" } }

    const { sttRouter } = await import("./stt.js")
    const app = new Hono().route("/api/stt", sttRouter)

    const form = new FormData()
    form.set("file", new Blob(["audio data"]), "test.wav")

    const res = await app.request("/api/stt", {
      method: "POST",
      headers: { Authorization: "Bearer test-session-token" },
      body: form,
    })

    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json.text).toBe("bearer auth works")
  })
})

// ── TTS proxy ──────────────────────────────────────────────────────────────

describe("POST /api/tts (TTS proxy)", () => {
  it("requires x-sidecar-secret when SIDECAR_SECRET is set", async () => {
    const { ttsRouter } = await import("./tts.js")
    const app = new Hono().route("/api/tts", ttsRouter)
    const res = await app.request("/api/tts", { method: "POST" })
    expect(res.status).toBe(401)
  })

  it("rejects missing ELEVENLABS_API_KEY", async () => {
    delete process.env.ELEVENLABS_API_KEY
    const { ttsRouter } = await import("./tts.js")
    const app = new Hono().route("/api/tts", ttsRouter)
    const res = await app.request("/api/tts", {
      method: "POST",
      headers: {
        "x-sidecar-secret": "test-sidecar-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hello", voice_id: "voice-1" }),
    })
    expect(res.status).toBe(500)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain("ELEVENLABS_API_KEY")
  })

  it("rejects missing text field", async () => {
    const { ttsRouter } = await import("./tts.js")
    const app = new Hono().route("/api/tts", ttsRouter)
    const res = await app.request("/api/tts", {
      method: "POST",
      headers: {
        "x-sidecar-secret": "test-sidecar-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice_id: "voice-1" }),
    })
    expect(res.status).toBe(400)
  })

  it("rejects missing voice_id field", async () => {
    const { ttsRouter } = await import("./tts.js")
    const app = new Hono().route("/api/tts", ttsRouter)
    const res = await app.request("/api/tts", {
      method: "POST",
      headers: {
        "x-sidecar-secret": "test-sidecar-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hello" }),
    })
    expect(res.status).toBe(400)
  })

  it("forwards request to ElevenLabs and streams back audio", async () => {
    mockElevenLabs(200, "fake-mp3-binary-data", "audio/mpeg")

    const { ttsRouter } = await import("./tts.js")
    const app = new Hono().route("/api/tts", ttsRouter)

    const res = await app.request("/api/tts", {
      method: "POST",
      headers: {
        "x-sidecar-secret": "test-sidecar-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "Hello, this is a test.",
        voice_id: "voice-123",
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("audio/mpeg")

    // Verify ElevenLabs was called correctly
    expect(elevenlabsCalls.length).toBe(1)
    expect(elevenlabsCalls[0]!.url).toContain("api.elevenlabs.io/v1/text-to-speech/voice-123/stream")
    expect(elevenlabsCalls[0]!.headers["xi-api-key"]).toBe("test-elevenlabs-key")

    const reqBody = JSON.parse(elevenlabsCalls[0]!.body as string) as Record<string, unknown>
    expect(reqBody.text).toBe("Hello, this is a test.")
    expect(reqBody.model_id).toBe("eleven_flash_v2_5")
    expect((reqBody.voice_settings as Record<string, unknown>).stability).toBe(0.5)
  })

  it("uses default model and voice settings when not provided", async () => {
    mockElevenLabs(200, "fake-mp3", "audio/mpeg")

    const { ttsRouter } = await import("./tts.js")
    const app = new Hono().route("/api/tts", ttsRouter)

    await app.request("/api/tts", {
      method: "POST",
      headers: {
        "x-sidecar-secret": "test-sidecar-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hello", voice_id: "voice-1" }),
    })

    const reqBody = JSON.parse(elevenlabsCalls[0]!.body as string) as Record<string, unknown>
    expect(reqBody.model_id).toBe("eleven_flash_v2_5")
    expect((reqBody.voice_settings as Record<string, unknown>).stability).toBe(0.3)
  })

  it("forwards upstream TTS errors", async () => {
    mockElevenLabs(400, { detail: "Invalid voice_id" })

    const { ttsRouter } = await import("./tts.js")
    const app = new Hono().route("/api/tts", ttsRouter)

    const res = await app.request("/api/tts", {
      method: "POST",
      headers: {
        "x-sidecar-secret": "test-sidecar-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hello", voice_id: "bad-voice" }),
    })

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.error).toContain("ElevenLabs TTS failed")
  })

  it("TTS accepts Authorization Bearer token instead of sidecar secret", async () => {
    mockElevenLabs(200, "fake-mp3", "audio/mpeg")
    mockAuthSession = { user: { id: "test-user" }, session: { id: "test-session" } }

    const { ttsRouter } = await import("./tts.js")
    const app = new Hono().route("/api/tts", ttsRouter)

    const res = await app.request("/api/tts", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hello", voice_id: "voice-1" }),
    })

    expect(res.status).toBe(200)
  })
})
