const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"

export interface ElevenLabsTtsOptions {
  voiceId?: string
  model_id?: string
  language_code?: string
  output_format?: string
}

export async function elevenLabsSynthesize(
  text: string,
  opts: ElevenLabsTtsOptions = {},
): Promise<Uint8Array> {
  const token = process.env.YOMI_SESSION_TOKEN
  const backendUrl = process.env.YOMI_BACKEND_URL ?? process.env.BACKEND_URL

  // Production: proxy through authenticated backend
  if (backendUrl && token) {
    const res = await fetch(`${backendUrl.replace(/\/+$/, "")}/api/v1/elevenlabs/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text,
        voice_id: opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
        model_id: opts.model_id ?? process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5",
        language_code: opts.language_code ?? process.env.ELEVENLABS_TTS_LANGUAGE,
        output_format:
          opts.output_format ?? process.env.ELEVENLABS_TTS_OUTPUT_FORMAT ?? "mp3_44100_128",
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText)
      throw new Error(`TTS proxy error ${res.status}: ${body}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  }

  // Dev: direct ElevenLabs API
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set")

  const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID
  const outputFormat =
    opts.output_format ?? process.env.ELEVENLABS_TTS_OUTPUT_FORMAT ?? "mp3_44100_128"
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`)
  url.searchParams.set("output_format", outputFormat)

  const body: Record<string, string> = {
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
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
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
