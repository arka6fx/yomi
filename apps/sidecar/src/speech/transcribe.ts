import { transcribeElevenLabs, transcribeElevenLabsFinal, type ElevenLabsChunk } from "./stt-elevenlabs.js"
import { transcribeWhisper } from "./stt-whisper.js"

export async function transcribe(wav: Uint8Array): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY
  if (key) {
    try {
      return await transcribeElevenLabsFinal(wav, key)
    } catch (err) {
      console.warn("[yomi/stt] ElevenLabs failed, falling back to local Whisper:", err)
    }
  }
  return transcribeWhisper(wav)
}

export async function* transcribeStreaming(wav: Uint8Array): AsyncGenerator<ElevenLabsChunk> {
  const key = process.env.ELEVENLABS_API_KEY
  if (key) {
    try {
      yield* transcribeElevenLabs(wav, key)
      return
    } catch (err) {
      console.warn("[yomi/stt] ElevenLabs streaming failed, falling back to Whisper:", err)
    }
  }
  const text = await transcribeWhisper(wav)
  yield { type: "final", text }
}
