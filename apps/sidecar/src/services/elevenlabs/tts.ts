const DEFAULT_TTS_MODEL = "eleven_flash_v2_5"
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"

function apiKey(): string {
  const key = process.env["ELEVENLABS_API_KEY"]
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured")
  return key
}

function voiceId(): string {
  return process.env["ELEVENLABS_VOICE_ID"] || DEFAULT_VOICE_ID
}

export async function* elevenLabsSynthesize(text: string): AsyncGenerator<Uint8Array> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId()}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: process.env["ELEVENLABS_TTS_MODEL"] || DEFAULT_TTS_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
        },
      }),
    },
  )

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${body || response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error("ElevenLabs TTS returned no audio stream")

  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    if (value?.byteLength) yield value
  }
}
