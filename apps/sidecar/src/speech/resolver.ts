import { novaSonicSynthesize } from "../services/bedrock/nova-sonic.js"

export type TtsEngine = "nova-sonic" | "none"

export function resolveTts(): TtsEngine {
  const explicit = process.env.TTS_ENGINE?.toLowerCase() as TtsEngine | undefined
  if (explicit === "nova-sonic" || explicit === "none") return explicit
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return "nova-sonic"
  return "none"
}

export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
  if (resolveTts() === "none") return
  yield await novaSonicSynthesize(text)
}
