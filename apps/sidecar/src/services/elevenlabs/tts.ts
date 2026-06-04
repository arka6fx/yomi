// Sarah — a premade voice in the default account set. Library voices (e.g. Rachel
// 21m00Tcm4TlvDq8ikWAM) return 402 paid_plan_required for free-tier API keys.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"

export interface ElevenLabsTtsOptions {
  voiceId?: string
  model_id?: string
  output_format?: string
  language_code?: string
}

export async function elevenLabsSynthesize(
  text: string,
  opts: ElevenLabsTtsOptions = {},
): Promise<Uint8Array> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set")

  const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID
  const outputFormat =
    opts.output_format ?? process.env.ELEVENLABS_TTS_OUTPUT_FORMAT ?? "mp3_44100_128"
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`)
  url.searchParams.set("output_format", outputFormat)

  const body: Record<string, unknown> = {
    text,
    model_id: opts.model_id ?? process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5",
  }
  const language = opts.language_code ?? process.env.ELEVENLABS_TTS_LANGUAGE
  if (language) body.language_code = language

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 12000)
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => res.statusText)
    throw new Error(`ElevenLabs TTS error ${res.status}: ${bodyText}`)
  }

  return new Uint8Array(await res.arrayBuffer())
}
