import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { authenticate } from "../auth.js"
import { requireAccess } from "../middleware/subscription.js"

const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"

export const sttRouter = new Hono()

sttRouter.post("/", authenticate, requireAccess("voice"), async (c) => {
  const { audio_b64 } = (await c.req.json()) as { audio_b64: string }
  const user = c.get("user")

  const apiKey = process.env["SARVAM_API_KEY"]
  if (!apiKey) return c.json({ error: "SARVAM_API_KEY not configured" }, 500)

  const audioBuffer = Buffer.from(audio_b64, "base64")
  const form = new FormData()
  form.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "audio.wav")
  form.append("model", "saarika:v2.5")

  const res = await fetch(SARVAM_STT_URL, {
    method: "POST",
    headers: { "api-subscription-key": apiKey },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    return c.json({ error: `Sarvam STT error ${res.status}: ${body}` }, 502)
  }

  const data = (await res.json()) as { transcript: string; language_code: string }

  await db.insert(usageEvents).values({
    userId: user.id,
    kind: "stt",
    model: "saarika:v2.5",
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    status: "done",
  })

  return c.json({ transcript: data.transcript })
})
