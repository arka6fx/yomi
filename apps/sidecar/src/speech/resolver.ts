import { elevenLabsSynthesize } from "../services/elevenlabs/tts.js"

export type TtsEngine = "elevenlabs" | "none"

export function resolveTts(): TtsEngine {
  const explicit = process.env.TTS_ENGINE?.toLowerCase() as TtsEngine | undefined
  if (explicit === "elevenlabs" || explicit === "none") return explicit
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs"
  return "none"
}

export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
  if (resolveTts() === "none") return
  yield* elevenLabsSynthesize(text)
}
