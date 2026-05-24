const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"

export type SarvamSpeaker =
  | "anushka" | "abhilash" | "manisha" | "vidya" | "arya"
  | "karun" | "hitesh" | "aditya" | "ritu" | "priya"
  | "neha" | "rahul" | "pooja" | "rohan" | "simran"
  | "kavya" | "amit" | "dev" | "ishita" | "shreya"
  | "ratan" | "varun" | "manan" | "sumit" | "roopa"
  | "kabir" | "aayan" | "shubh" | "ashutosh" | "advait"
  | "anand" | "tanya" | "tarun" | "sunny" | "mani"
  | "gokul" | "vijay" | "shruti" | "suhani" | "mohit"
  | "kavitha" | "rehan" | "soham" | "rupali"

export interface SarvamTtsOptions {
  target_language_code?: string
  speaker?: SarvamSpeaker
  model?: "bulbul:v2" | "bulbul:v3-beta" | "bulbul:v3"
  pitch?: number
  pace?: number
  loudness?: number
  speech_sample_rate?: 8000 | 16000 | 22050 | 24000
  enable_preprocessing?: boolean
}

export interface SarvamTtsResponse {
  audios: string[] // base64-encoded WAV per input
  request_id?: string
}

// Returns raw WAV bytes for each input string.
export async function sarvamSynthesize(
  inputs: string[],
  opts: SarvamTtsOptions = {},
): Promise<Uint8Array[]> {
  const apiKey = process.env.SARVAM_API_KEY
  if (!apiKey) throw new Error("SARVAM_API_KEY is not set")

  const body: Record<string, unknown> = {
    inputs,
    target_language_code: opts.target_language_code ?? "en-IN",
    speaker: opts.speaker ?? (process.env.SARVAM_VOICE as typeof opts.speaker ?? "shreya"),
    model: opts.model ?? "bulbul:v3",
    // 16 kHz matches the renderer AudioContext — no resampling = no crackle
    speech_sample_rate: opts.speech_sample_rate ?? 16000,
    pace: opts.pace ?? 1.0,
  }
  if (opts.pitch != null) body.pitch = opts.pitch
  if (opts.pace != null) body.pace = opts.pace
  if (opts.loudness != null) body.loudness = opts.loudness
  if (opts.speech_sample_rate != null) body.speech_sample_rate = opts.speech_sample_rate
  if (opts.enable_preprocessing != null) body.enable_preprocessing = opts.enable_preprocessing

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 8000) // 8 s hard limit
  let res: Response
  try {
    res = await fetch(SARVAM_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText)
    throw new Error(`Sarvam TTS error ${res.status}: ${errBody}`)
  }

  const data = (await res.json()) as SarvamTtsResponse
  return data.audios.map((b64) => Uint8Array.from(Buffer.from(b64, "base64")))
}
