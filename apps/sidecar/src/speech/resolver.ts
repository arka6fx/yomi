import { synthesizeElevenLabs } from "./tts-elevenlabs.js"
import { synthesizePiper } from "./tts-piper.js"
import { synthesizeEdgeTts } from "./tts-edge.js"

export type TtsEngine = "elevenlabs" | "edge-tts" | "piper" | "none"

// Selection precedence:
// 1. TTS_ENGINE=<engine>           — explicit override (always wins; "none" disables TTS)
// 2. ELEVENLABS_API_KEY set        — cloud premium
// 3. fallback                      — piper (offline)
export function resolveTts(): TtsEngine {
  const explicit = process.env.TTS_ENGINE?.toLowerCase()
  if (explicit === "elevenlabs" || explicit === "edge-tts" || explicit === "piper" || explicit === "none") {
    return explicit
  }
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs"
  return "piper"
}

// Single entry point: pick the engine, dispatch, yield audio bytes.
// Errors from the provider propagate; callers decide whether to drop audio.
export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
  const engine = resolveTts()
  if (engine === "none") return
  if (engine === "elevenlabs") {
    const key = process.env.ELEVENLABS_API_KEY
    if (!key) throw new Error("ELEVENLABS_API_KEY required for elevenlabs engine")
    yield* synthesizeElevenLabs(text, key)
    return
  }
  if (engine === "edge-tts") {
    yield* synthesizeEdgeTts(text)
    return
  }
  yield* synthesizePiper(text)
}
