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
      setTts(enabled: boolean): void
      // Window control
      startDrag(offsetX: number, offsetY: number): void
      moveDrag(screenX: number, screenY: number): void
      resize(w: number, h: number): void
      setMouseEventsIgnored(ignored: boolean): void
      setHitRegions(regions: { x: number; y: number; width: number; height: number }[]): void
      nudge(dx: number, dy: number): void
      // Queries
      submitTextQuery(text: string, attachmentB64?: string): void
      copyText(text: string): Promise<{ ok: boolean }>
      // Subscription
      getSubscriptionInfo(): Promise<SubscriptionInfo | null>
      updateProfileName(name: string): Promise<{ name: string; email: string }>
      onSubscriptionUpdate(cb: (info: SubscriptionUpdate) => void): () => void
      // Audio control
      onStopAudio(cb: () => void): () => void
      getDesktopSourceId(): Promise<string | null>
      requestEscape(): void
      triggerVoice(): void
      triggerText(): void
      triggerAnalyze(): void
      stopListening(): void
      // App control
      quit(): void
      openUpgrade(): void
      openDashboard(): void
      openIntegrationsPage(): void
      pickAttachment(): Promise<{ path: string; b64: string } | null>
      // Auto-update
      onUpdateAvailable(cb: (info: { version: string; releaseDate: string }) => void): () => void
      onUpdateDownloaded(cb: (info: { version: string }) => void): () => void
      onUpdateProgress(
        cb: (info: {
          percent: number
          bytesPerSecond: number
          transferred: number
          total: number
        }) => void,
      ): () => void
      onUpdateError(cb: (info: { message: string }) => void): () => void
      downloadUpdate(): void
      installUpdate(): void
      // Integrations
      getIntegrations(): Promise<
        {
          id: string
          provider: string
          displayName: string
          scopes: string[]
          connected: boolean
          lastSyncAt: string | null
          expiresAt: string | null
          createdAt: string
        }[]
      >
      connectIntegration(id: string): Promise<{ ok?: boolean; error?: string; kind?: string }>
      disconnectIntegration(provider: string): Promise<{ ok?: boolean; error?: string }>
      // RAG: Drive sources
      getDriveSources(): Promise<{
        sources?: {
          id: string
          name: string
          folderId: string
          status: string
          syncState: { filesIndexed: number; filesSkipped: number; lastSyncedAt: string | null }
        }[]
        error?: string
        code?: string
      }>
      createDriveSource(input: {
        folderId: string
        name?: string
      }): Promise<{ id?: string; error?: string; code?: string }>
      deleteDriveSource(id: string): Promise<{ ok?: boolean; error?: string; code?: string }>
      // Suggested automations
      getSuggestions(): Promise<{
        suggestions?: {
          dedupKey: string
          title: string
          description: string
          schedulePreview: string
        }[]
        error?: string
        code?: string
      }>
      acceptSuggestion(
        dedupKey: string,
      ): Promise<{ scheduleId?: string; error?: string; code?: string }>
      dismissSuggestion(dedupKey: string): Promise<{ ok?: boolean; error?: string; code?: string }>
      // Bot channels (Telegram)
      getBotConnections(): Promise<{ platform: string; connectedAt: string }[]>
      connectTelegramBot(): Promise<{ ok?: boolean; error?: string }>
      unlinkBot(platform: string): Promise<{ ok?: boolean; error?: string }>
      // Local management
      getSessions(query?: string): Promise<unknown[]>
      deleteSession(id: number): Promise<{ ok?: boolean; deleted?: boolean; error?: string }>
      getMemories(query?: string): Promise<unknown[]>
      addMemory(input: {
        content: string
        topic?: string
        kind?: string
        scope?: string
      }): Promise<{ memory?: unknown; error?: string }>
      deleteMemory(id: string): Promise<{ ok?: boolean; error?: string }>
      getSchedules(): Promise<unknown[]>
      saveSchedule(input: {
        id?: string
        schedule: string
        prompt: string
        deliverTo?: string[]
        enabled?: boolean
      }): Promise<{ schedule?: unknown; error?: string }>
      setScheduleEnabled(
        id: string,
        enabled: boolean,
      ): Promise<{ schedule?: unknown; error?: string }>
      deleteSchedule(id: string): Promise<{ ok?: boolean; deleted?: boolean; error?: string }>
      getDiagnostics(): Promise<{ diagnostics?: unknown; logs?: string[]; error?: string }>
    }
  }
}
