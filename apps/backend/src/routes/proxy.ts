import { Hono } from "hono"
import { stream } from "hono/streaming"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { db, usageEvents } from "@yomi/db"
import { authenticate } from "../auth.js"
import { requireAccess } from "../middleware/subscription.js"

const OPENAI_BASE_URL = process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1"
const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech"

export const proxyRouter = new Hono()

proxyRouter.use("*", authenticate)

proxyRouter.post("/elevenlabs/stt", requireAccess("voice"), async (c) => {
  const user = c.get("user")
  const apiKey = process.env["ELEVENLABS_API_KEY"]
  if (!apiKey) return c.json({ error: "ELEVENLABS_API_KEY not configured" }, 500)

  const { audio_b64, model_id, language_code, no_verbatim } = (await c.req.json()) as {
    audio_b64: string
    model_id?: string
    language_code?: string
    no_verbatim?: boolean
  }

  const audioBuffer = Buffer.from(audio_b64, "base64")
  const form = new FormData()
  form.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "audio.wav")
  form.append("model_id", model_id ?? process.env["ELEVENLABS_STT_MODEL"] ?? "scribe_v2")
  form.append("file_format", "other")
  form.append("tag_audio_events", "false")
  form.append("no_verbatim", String(no_verbatim ?? true))
  if (language_code ?? process.env["ELEVENLABS_STT_LANGUAGE"])
    form.append("language_code", language_code ?? process.env["ELEVENLABS_STT_LANGUAGE"]!)

  const res = await fetch(ELEVENLABS_STT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText)
    return c.json({ error: `ElevenLabs STT error ${res.status}: ${errBody}` }, 502)
  }

  const data = (await res.json()) as { text: string }

  await db.insert(usageEvents).values({
    userId: user.id,
    kind: "stt",
    model: process.env["ELEVENLABS_STT_MODEL"] ?? "scribe_v2",
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    status: "done",
  })

  return c.json(data)
})

proxyRouter.post("/elevenlabs/tts", requireAccess("voice"), async (c) => {
  const user = c.get("user")
  const apiKey = process.env["ELEVENLABS_API_KEY"]
  if (!apiKey) return c.json({ error: "ELEVENLABS_API_KEY not configured" }, 500)

  const body = await c.req.json() as Record<string, string | undefined>
  const voiceId = body.voice_id ?? process.env["ELEVENLABS_VOICE_ID"] ?? "EXAVITQu4vr4xnSDxMaL"
  const outputFormat = body.output_format ?? process.env["ELEVENLABS_TTS_OUTPUT_FORMAT"] ?? "mp3_44100_128"

  const url = new URL(`${ELEVENLABS_TTS_URL}/${voiceId}/stream`)
  url.searchParams.set("output_format", outputFormat)

  const ttsBody: Record<string, string> = {
    text: body.text ?? "",
    model_id: body.model_id ?? process.env["ELEVENLABS_TTS_MODEL"] ?? "eleven_flash_v2_5",
  }
  if (body.language_code) ttsBody.language_code = body.language_code

  const ttsRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify(ttsBody),
  })

  if (!ttsRes.ok) {
    const errBody = await ttsRes.text().catch(() => ttsRes.statusText)
    return c.json({ error: `ElevenLabs TTS error ${ttsRes.status}: ${errBody}` }, 502)
  }

  await db.insert(usageEvents).values({
    userId: user.id,
    kind: "tts",
    model: process.env["ELEVENLABS_TTS_MODEL"] ?? "eleven_flash_v2_5",
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    status: "done",
  })

  const audioBuffer = await ttsRes.arrayBuffer()
  return c.body(audioBuffer, 200 as ContentfulStatusCode, {
    "Content-Type": "audio/mpeg",
    "Content-Length": audioBuffer.byteLength.toString(),
  })
})

proxyRouter.post("/chat/completions", async (c) => {
  const openaiKey = process.env["OPENAI_API_KEY"]
  if (!openaiKey) return c.json({ error: "OPENAI_API_KEY not configured" }, 500)

  const body = await c.req.json()

  const targetUrl = `${OPENAI_BASE_URL.replace(/\/+$/, "")}/chat/completions`

  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => upstream.statusText)
    return c.json(
      { error: `Upstream error ${upstream.status}: ${errBody}` },
      upstream.status as ContentfulStatusCode,
    )
  }

  if (!body.stream) {
    const json = await upstream.json()
    return c.json(json)
  }

  if (!upstream.body) {
    return c.json({ error: "Empty upstream response body" }, 502)
  }

  c.header("Content-Type", "text/event-stream")
  c.header("Cache-Control", "no-cache")
  c.header("Connection", "keep-alive")

  return stream(c, async (streamWriter) => {
    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        await streamWriter.write(text)
      }
    } finally {
      reader.releaseLock()
    }
  })
})
