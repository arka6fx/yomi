import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { authenticate } from "../auth.js"

export const sttRouter = new Hono()

sttRouter.post("/", authenticate, async (c) => {
  const { audio_b64 } = await c.req.json() as { audio_b64: string }
  const user = c.get("user")

  const apiKey = process.env["ELEVENLABS_API_KEY"]
  if (!apiKey) return c.json({ error: "STT unavailable" }, 503)

  // Decode base64 audio and forward to ElevenLabs STT
  const audioBuffer = Buffer.from(audio_b64, "base64")
  const form = new FormData()
  form.append("audio", new Blob([audioBuffer], { type: "audio/webm" }), "audio.webm")
  form.append("model_id", "scribe_v1")

  const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  })

  if (!resp.ok) {
    const msg = await resp.text()
    return c.json({ error: "STT failed", detail: msg }, 502)
  }

  const { text } = await resp.json() as { text: string }

  // Log STT usage (no token count for STT)
  await db.insert(usageEvents).values({
    userId: user.id,
    kind: "stt",
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    status: "done",
  })

  return c.json({ transcript: text })
})
