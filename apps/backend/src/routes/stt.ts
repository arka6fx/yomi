import { Hono } from "hono"
import type { Context } from "hono"
import { transcribeBuffer } from "../services/transcription.js"

// Machine-to-machine only. STT/TTS are reached exclusively through the metered voice
// pipeline (desktop reserves `voice` → sidecar → backend), so a plain user session
// must NOT be able to call the speech providers directly and bypass the credit meter.
function isAuthorized(c: Context): boolean {
  const secret = process.env.SIDECAR_SECRET
  const header = c.req.header("x-sidecar-secret")
  if (secret && header === secret) return true
  if (!secret && header === secret) return true // both unset → allow (dev)
  return false
}

export const sttRouter = new Hono()

sttRouter.post("/", async (c) => {
  if (!isAuthorized(c)) return c.json({ error: "Unauthorized" }, 401)

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
