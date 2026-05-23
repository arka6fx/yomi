import { sarvamTranscribe } from "../services/sarvam/stt.js"

export async function transcribe(wav: Uint8Array): Promise<string> {
  const result = await sarvamTranscribe(wav)
  return result.transcript
}

export async function* transcribeStreaming(wav: Uint8Array): AsyncGenerator<{ type: "final"; text: string }> {
  const text = await transcribe(wav)
  yield { type: "final", text }
}
