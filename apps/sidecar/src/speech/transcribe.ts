import { novaSonicTranscribe } from "../services/bedrock/nova-sonic.js"

export async function transcribe(wav: Uint8Array): Promise<string> {
  const result = await novaSonicTranscribe(wav)
  return result.text
}

export async function* transcribeStreaming(
  wav: Uint8Array,
): AsyncGenerator<{ type: "final"; text: string }> {
  const text = await transcribe(wav)
  yield { type: "final", text }
}

// ── Legacy: ElevenLabs STT (kept for rollback) ───────────────────────────────
// import { elevenLabsTranscribe } from "../services/elevenlabs/stt.js"
//
// export async function transcribe(wav: Uint8Array): Promise<string> {
//   const result = await elevenLabsTranscribe(wav)
//   return result.text
// }
//
// export async function* transcribeStreaming(
//   wav: Uint8Array,
// ): AsyncGenerator<{ type: "final"; text: string }> {
//   const text = await transcribe(wav)
//   yield { type: "final", text }
// }
