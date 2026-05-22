import type { SseEvent } from "@yomi/shared"
import type { HotkeyState } from "./store"

declare global {
  interface Window {
    yomi: {
      sendAudioChunk(pcm: ArrayBuffer, sampleRate: number): void
      onEvent(cb: (e: SseEvent) => void): () => void
      onStateChange(cb: (s: HotkeyState) => void): () => void
    }
  }
}
