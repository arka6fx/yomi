import { Hono } from "hono"
import { transcribeBuffer } from "../services/transcription.js"
import { isSpeechAuthorized } from "../middleware/speech-auth.js"

export const sttRouter = new Hono()

sttRouter.post("/", async (c) => {
  if (!isSpeechAuthorized(c)) return c.json({ error: "Unauthorized" }, 401)

  const body = await c.req.parseBody()
  const file = body["file"] as File | undefined
  if (!file) return c.json({ error: "file field required" }, 400)

  // OpenAI transcription (primary) with ElevenLabs scribe_v2 fallback.
  try {
    const text = await transcribeBuffer(await file.arrayBuffer(), file.type || "audio/wav")
    return c.json({ text })
  } catch (err) {
    const message = err instanceof Error ? err.message : "STT failed"
    return c.json({ error: `STT failed: ${message}` }, 500)
  }
})
