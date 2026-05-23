import type { SseEvent } from "@yomi/shared"
import type { HotkeyState } from "./store"

declare global {
  interface Window {
    yomi: {
      sendAudioChunk(pcm: ArrayBuffer, sampleRate: number): void
      onEvent(cb: (e: SseEvent) => void): () => void
      onStateChange(cb: (s: HotkeyState) => void): () => void
      startDrag(offsetX: number, offsetY: number): void
      moveDrag(screenX: number, screenY: number): void
      resize(w: number, h: number): void
      submitTextQuery(text: string): void
      nudge(dx: number, dy: number): void
    }
  }
}
