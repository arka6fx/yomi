// ElevenLabs TTS via raw fetch. Mirrors stt-elevenlabs.ts to avoid coupling
// to SDK-version-specific shapes. Yields MP3 audio chunks as Uint8Array.

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM" // Rachel
const DEFAULT_MODEL_ID = "eleven_turbo_v2"
const DEFAULT_OUTPUT_FORMAT = "mp3_22050_32"

export interface ElevenLabsTtsOptions {
  voiceId?: string
  modelId?: string
  outputFormat?: string
  stability?: number
  similarityBoost?: number
}

export async function* synthesizeElevenLabs(
  text: string,
  apiKey: string,
  opts: ElevenLabsTtsOptions = {},
): AsyncGenerator<Uint8Array> {
  const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID
  const modelId = opts.modelId ?? process.env.ELEVENLABS_TTS_MODEL ?? DEFAULT_MODEL_ID
  const outputFormat = opts.outputFormat ?? DEFAULT_OUTPUT_FORMAT

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(outputFormat)}`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: opts.stability ?? 0.5,
        similarity_boost: opts.similarityBoost ?? 0.75,
      },
    }),
  })

  if (!res.ok || !res.body) {
    throw new Error(`ElevenLabs TTS ${res.status}`)
  }

  const reader = res.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return
      if (value && value.byteLength > 0) yield value
    }
  } finally {
    reader.releaseLock()
  }
}
