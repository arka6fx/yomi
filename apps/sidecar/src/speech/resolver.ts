import { novaSonicSynthesize } from "../services/bedrock/nova-sonic.js"

export type TtsEngine = "nova-sonic" | "elevenlabs" | "none"

export function resolveTts(): TtsEngine {
  const explicit = process.env.TTS_ENGINE?.toLowerCase() as TtsEngine | undefined
  if (explicit === "nova-sonic" || explicit === "elevenlabs" || explicit === "none") return explicit
  if (process.env.AWS_BEDROCK_BEARER_TOKEN) return "nova-sonic"
  return "none"
}

export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
  if (resolveTts() === "none") return
  yield await novaSonicSynthesize(text)
}

// ── Legacy: ElevenLabs TTS (kept for rollback) ───────────────────────────────
// import { elevenLabsSynthesize } from "../services/elevenlabs/tts.js"
//
// export function resolveTts(): TtsEngine {
//   const explicit = process.env.TTS_ENGINE?.toLowerCase() as TtsEngine | undefined
//   if (explicit === "elevenlabs" || explicit === "none") return explicit
//   if (process.env.YOMI_SESSION_TOKEN || process.env.ELEVENLABS_API_KEY) return "elevenlabs"
//   return "none"
// }
//
// export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
//   if (resolveTts() === "none") return
//   yield await elevenLabsSynthesize(text)
// }
