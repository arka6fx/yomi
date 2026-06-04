import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { authenticate } from "../auth.js"
import { requireAccess } from "../middleware/subscription.js"

const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"

export const sttRouter = new Hono()

sttRouter.post("/", authenticate, requireAccess("voice"), async (c) => {
  const { audio_b64 } = (await c.req.json()) as { audio_b64: string }
  const user = c.get("user")

  const apiKey = process.env["ELEVENLABS_API_KEY"]
  if (!apiKey) return c.json({ error: "ELEVENLABS_API_KEY not configured" }, 500)

  const audioBuffer = Buffer.from(audio_b64, "base64")
  const form = new FormData()
  form.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "audio.wav")
  form.append("model_id", process.env["ELEVENLABS_STT_MODEL"] ?? "scribe_v2")
  form.append("file_format", "other")
  form.append("tag_audio_events", "false")
  form.append("no_verbatim", "true")
  if (process.env["ELEVENLABS_STT_LANGUAGE"])
    form.append("language_code", process.env["ELEVENLABS_STT_LANGUAGE"])

  const res = await fetch(ELEVENLABS_STT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    return c.json({ error: `ElevenLabs STT error ${res.status}: ${body}` }, 502)
  }

  const data = (await res.json()) as { text: string; language_code: string }

  await db.insert(usageEvents).values({
    userId: user.id,
    kind: "stt",
    model: process.env["ELEVENLABS_STT_MODEL"] ?? "scribe_v2",
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    status: "done",
  })

  return c.json({ transcript: data.text })
})
