import type { SseEvent } from "@yomi/shared"
import type { HotkeyState } from "./store"
import type { SubscriptionInfo, SubscriptionUpdate } from "../preload/index"

type AuthStatus = "ok" | "needed" | "waiting" | "error"

declare global {
  interface Window {
    yomi: {
      // Auth
      startAuth(provider?: "github" | "google"): void
      signOut(): void
      onAuthStatus(cb: (status: AuthStatus, detail?: string) => void): () => void
      // Events
      onEvent(cb: (e: SseEvent) => void): () => void
      onStateChange(cb: (s: HotkeyState) => void): () => void
      // Audio
      sendAudioChunk(pcm: ArrayBuffer, sampleRate: number): void
      // Window control
      startDrag(offsetX: number, offsetY: number): void
      moveDrag(screenX: number, screenY: number): void
      resize(w: number, h: number): void
      setMouseEventsIgnored(ignored: boolean): void
      nudge(dx: number, dy: number): void
      // Queries
      submitTextQuery(text: string): void
      // Subscription
      getSubscriptionInfo(): Promise<SubscriptionInfo>
      onSubscriptionUpdate(cb: (info: SubscriptionUpdate) => void): () => void
      // Audio control
      onStopAudio(cb: () => void): () => void
      getDesktopSourceId(): Promise<string | null>
      requestEscape(): void
      // App control
      quit(): void
      openUpgrade(): void
      setOpacity(value: number): void
    }
  }
}
