import { Hono } from "hono"
import type { Context } from "hono"
import { defaultVoiceSettings, synthesizeSpeech } from "../services/tts.js"

// Machine-to-machine only — see stt.ts. Direct user-session access would bypass the
// credit meter, so only the sidecar (with the shared secret) may reach ElevenLabs.
function isAuthorized(c: Context): boolean {
  const secret = process.env.SIDECAR_SECRET
  const header = c.req.header("x-sidecar-secret")
  if (secret && header === secret) return true
  if (!secret && header === secret) return true // both unset → allow (dev)
  return false
}

export const ttsRouter = new Hono()

ttsRouter.post("/", async (c) => {
  if (!isAuthorized(c)) return c.json({ error: "Unauthorized" }, 401)

  const { text, voice_id, model_id, voice_settings } = (await c.req.json()) as {
    text: string
    voice_id: string
    model_id?: string
    voice_settings?: {
      stability?: number
      similarity_boost?: number
      style?: number
      use_speaker_boost?: boolean
    }
  }

  if (!text) return c.json({ error: "text field required" }, 400)
  if (!voice_id) return c.json({ error: "voice_id field required" }, 400)

  let result
  try {
    result = await synthesizeSpeech(text, {
      voiceId: voice_id,
      modelId: model_id,
      voiceSettings: voice_settings || defaultVoiceSettings(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS failed"
    const status = /ElevenLabs TTS failed \((\d{3})\)/.exec(message)?.[1]
    return c.json({ error: message }, status ? (Number(status) as 400 | 500) : 500)
  }

  c.header("Content-Type", result.contentType)
  c.header("Cache-Control", "no-store")

  return c.body(result.audio)
})
