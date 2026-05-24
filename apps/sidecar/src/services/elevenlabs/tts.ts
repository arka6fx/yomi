const BASE_URL = "https://api.elevenlabs.io/v1"

// Curated voices — override with ELEVENLABS_VOICE_ID env var
export const VOICES = {
  // Female
  sarah:   "EXAVITQu4vr4xnSDxMaL", // warm, soft, conversational (default)
  rachel:  "21m00Tcm4TlvDq8ikWAM", // calm, clear, American
  aria:    "9BWtsMINqrJLrRacOk9x",  // expressive, modern
  // Male
  liam:    "TX3LPaxmHKxFdv7VOQHJ", // young, clear, American
  charlie: "IKne3meq5aSn9XLyUdCD", // conversational, Australian
} as const

const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID ?? VOICES.sarah
// eleven_turbo_v2_5: lowest latency, natural quality — best for real-time TTS
const DEFAULT_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5"

// Synthesizes text and buffers the complete MP3 response for a sentence.
// Buffering per-sentence (rather than raw streaming) keeps the existing
// renderer's decodeAudioData() path working without changes.
export async function* elevenLabsSynthesize(
  text: string,
  voiceId = DEFAULT_VOICE,
  model = DEFAULT_MODEL,
): AsyncGenerator<Uint8Array> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set")

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 10_000)

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/text-to-speech/${voiceId}/stream`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        output_format: "mp3_44100_128",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
      signal: abort.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText)
    throw new Error(`ElevenLabs TTS ${res.status}: ${errBody}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("ElevenLabs TTS: no response body")

  // Collect all chunks into one decodable MP3 buffer
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value?.length) chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (chunks.length === 0) return
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  yield out
}
