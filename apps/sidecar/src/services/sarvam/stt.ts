const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"

export interface SarvamSttResponse {
  transcript: string
  language_code: string
  disfluencies?: boolean
}

export interface SarvamSttOptions {
  model?: "saarika:v1" | "saarika:v2" | "saarika:v2.5"
  language_code?: string
  with_disfluencies?: boolean
}

export async function sarvamTranscribe(
  audio: Uint8Array,
  opts: SarvamSttOptions = {},
): Promise<SarvamSttResponse> {
  const apiKey = process.env.SARVAM_API_KEY
  if (!apiKey) throw new Error("SARVAM_API_KEY is not set")

  const form = new FormData()
  form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav")
  form.append("model", opts.model ?? "saarika:v2.5")
  if (opts.language_code) form.append("language_code", opts.language_code)
  if (opts.with_disfluencies != null)
    form.append("with_disfluencies", String(opts.with_disfluencies))

  const res = await fetch(SARVAM_STT_URL, {
    method: "POST",
    headers: { "api-subscription-key": apiKey },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Sarvam STT error ${res.status}: ${body}`)
  }

  return res.json() as Promise<SarvamSttResponse>
}
