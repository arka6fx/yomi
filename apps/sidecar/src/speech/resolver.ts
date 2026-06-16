import { elevenLabsSynthesize } from "../services/elevenlabs/tts.js"

export type TtsEngine = "elevenlabs" | "none"

// After a 429 (rate-limit) or 402 (credits exhausted), suppress TTS for
// 60 s so subsequent sentences in the same turn don't hammer ElevenLabs.
let rateLimitedUntil = 0

export function resolveTts(): TtsEngine {
  const explicit = process.env.TTS_ENGINE?.toLowerCase() as TtsEngine | undefined
  if (explicit === "elevenlabs" || explicit === "none") return explicit
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs"
  if (process.env.SIDECAR_SECRET) return "elevenlabs"
  return "none"
}

export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
  if (resolveTts() === "none") return
  if (Date.now() < rateLimitedUntil) return // silently skip — upstream emits tts_error
  try {
    yield* elevenLabsSynthesize(text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/\(429\)|\(402\)/.test(msg)) {
      rateLimitedUntil = Date.now() + 60_000
    }
    throw err
  }
}
