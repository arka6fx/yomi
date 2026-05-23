import { sarvamSynthesize } from "../services/sarvam/tts.js"

export type TtsEngine = "sarvam" | "none"

export function resolveTts(): TtsEngine {
  const explicit = process.env.TTS_ENGINE?.toLowerCase() as TtsEngine | undefined
  if (explicit === "sarvam" || explicit === "none") return explicit
  if (process.env.SARVAM_API_KEY) return "sarvam"
  return "none"
}

export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
  if (resolveTts() === "none") return
  const audios = await sarvamSynthesize([text])
  if (audios[0]) yield audios[0]
}
