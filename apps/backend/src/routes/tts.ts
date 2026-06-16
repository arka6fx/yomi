import { Hono } from "hono"

export const ttsRouter = new Hono()

ttsRouter.post("/", async (c) => {
  const secret = process.env.SIDECAR_SECRET
  const header = c.req.header("x-sidecar-secret")
  if (secret && header !== secret) return c.json({ error: "Unauthorized" }, 401)

  const apiKey = process.env["ELEVENLABS_API_KEY"]
  if (!apiKey) return c.json({ error: "ELEVENLABS_API_KEY not configured" }, 500)

  const { text, voice_id, model_id, voice_settings } = await c.req.json() as {
    text: string
    voice_id: string
    model_id?: string
    voice_settings?: { stability?: number; similarity_boost?: number }
  }

  if (!text) return c.json({ error: "text field required" }, 400)
  if (!voice_id) return c.json({ error: "voice_id field required" }, 400)

  const outputFormat = "mp3_22050_32"
  const latencyOpt = "4"

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/stream?output_format=${outputFormat}&optimize_streaming_latency=${latencyOpt}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: model_id || "eleven_flash_v2_5",
        voice_settings: voice_settings || { stability: 0.3, similarity_boost: 0.75 },
        apply_text_normalization: "off",
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return c.json({ error: `ElevenLabs TTS failed (${res.status})`, detail: body }, res.status as 400 | 500)
  }

  const contentType = res.headers.get("content-type") || "audio/mpeg"
  c.header("Content-Type", contentType)
  c.header("Cache-Control", "no-store")

  return c.newResponse(res.body)
})
