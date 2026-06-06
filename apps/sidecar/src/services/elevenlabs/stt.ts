const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"

export class ElevenLabsSttError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = "ElevenLabsSttError"
  }
}

export interface ElevenLabsSttResponse {
  text: string
  language_code?: string
  language_probability?: number
}

export interface ElevenLabsSttOptions {
  model_id?: "scribe_v2" | "scribe_v1"
  language_code?: string
  no_verbatim?: boolean
}

export async function elevenLabsTranscribe(
  audio: Uint8Array,
  opts: ElevenLabsSttOptions = {},
): Promise<ElevenLabsSttResponse> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error("Voice is not configured yet. Add ElevenLabs API key to enable voice.")

  const form = new FormData()
  form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav")
  form.append("model_id", opts.model_id ?? process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2")
  form.append("file_format", "other")
  form.append("tag_audio_events", "false")
  form.append("no_verbatim", String(opts.no_verbatim ?? true))
  const language = opts.language_code ?? process.env.ELEVENLABS_STT_LANGUAGE
  if (language) form.append("language_code", language)

  const res = await fetch(ELEVENLABS_STT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new ElevenLabsSttError(`ElevenLabs STT error ${res.status}`, res.status, body)
  }

  return res.json() as Promise<ElevenLabsSttResponse>
}
