import type { SseEvent } from "@yomi/shared"
import type { HotkeyState } from "./store"
import type {
  AutomationHealthResponse,
  AutomationKnowledgeResponse,
  AutomationProviderRepairResponse,
  AutomationWorkflowsResponse,
  SubscriptionInfo,
  SubscriptionUpdate,
} from "../preload/index"

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
      onLoopContinue(cb: () => void): () => void
      getDesktopSourceId(): Promise<string | null>
      requestEscape(): void
      triggerVoice(): void
      triggerText(): void
      triggerScreenshot(): void
      stopListening(): void
      bargeIn(): void
      // App control
      quit(): void
      openUpgrade(): void
      openDashboard(): void
      openIntegrationsPage(): void
      pickAttachment(): Promise<{ path: string; b64: string } | null>
      // Act mode (Spec 16)
      confirmAct(id: string, approved: boolean): void
      replayAutomation(replayId: string): void
      getAutomationHealth(): Promise<AutomationHealthResponse>
      repairAutomationProvider(providerId: string): Promise<AutomationProviderRepairResponse>
      getAutomationKnowledge(goal: string): Promise<AutomationKnowledgeResponse>
      getAutomationWorkflows(): Promise<AutomationWorkflowsResponse>
      // Auto-update
      onUpdateAvailable(cb: (info: { version: string; releaseDate: string }) => void): () => void
      onUpdateDownloaded(cb: (info: { version: string }) => void): () => void
      onUpdateError(cb: (info: { message: string }) => void): () => void
      downloadUpdate(): void
      installUpdate(): void
      // Integrations
      getIntegrations(): Promise<{
        id: string
        provider: string
        displayName: string
        scopes: string[]
        connected: boolean
        lastSyncAt: string | null
        expiresAt: string | null
        createdAt: string
      }[]>
      connectIntegration(id: string): Promise<{ ok?: boolean; error?: string; kind?: string }>
      disconnectIntegration(provider: string): Promise<{ ok?: boolean; error?: string }>
      // Bot channels (Telegram / Discord)
      getBotConnections(): Promise<{ platform: string; connectedAt: string }[]>
      connectTelegramBot(): Promise<{ ok?: boolean; error?: string }>
      connectDiscordBot(): Promise<{ ok?: boolean; error?: string }>
      unlinkBot(platform: string): Promise<{ ok?: boolean; error?: string }>
    }
  }
}
