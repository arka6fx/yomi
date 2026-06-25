import { contextBridge, ipcRenderer } from "electron"
import type { SseEvent } from "@yomi/shared"

type HotkeyState = "idle" | "listening" | "processing" | "text-input"
type AuthStatus = "ok" | "needed" | "waiting" | "error"

export interface SubscriptionInfo {
  name: string
  email: string
  role: string
  plan: string
  status: string
  trialEndDate: string | null
  currentPeriodEnd: string | null
  requestsUsed: number
  requestsLimit: number | null
  requestsRemaining: number | null
  resetAt: string | null
  dailyChatUsed: number
  dailyVoiceUsed: number
  dailyImageUsed: number
  tokensUsedThisPeriod: number
}

export type SubscriptionUpdate = Partial<SubscriptionInfo> & {
  plan?: string
}

contextBridge.exposeInMainWorld("yomi", {
  // ── Auth ──────────────────────────────────────────────────────────────────

  startAuth(provider?: "github" | "google"): void {
    ipcRenderer.invoke("yomi:start-auth", provider)
  },

  signOut(): void {
    ipcRenderer.send("yomi:sign-out")
  },

  onAuthStatus(cb: (status: AuthStatus, detail?: string) => void): () => void {
    const onOk = () => cb("ok")
    const onNeeded = () => cb("needed")
    const onWaiting = () => cb("waiting")
    const onError = (_: Electron.IpcRendererEvent, msg: string) => cb("error", msg)
    ipcRenderer.on("yomi:auth-ok", onOk)
    ipcRenderer.on("yomi:auth-needed", onNeeded)
    ipcRenderer.on("yomi:auth-waiting", onWaiting)
    ipcRenderer.on("yomi:auth-error", onError)
    return () => {
      ipcRenderer.off("yomi:auth-ok", onOk)
      ipcRenderer.off("yomi:auth-needed", onNeeded)
      ipcRenderer.off("yomi:auth-waiting", onWaiting)
      ipcRenderer.off("yomi:auth-error", onError)
    }
  },

  // ── Events ────────────────────────────────────────────────────────────────

  onEvent(cb: (e: SseEvent) => void): () => void {
    const h = (_: Electron.IpcRendererEvent, e: SseEvent) => cb(e)
    ipcRenderer.on("yomi:event", h)
    return () => ipcRenderer.off("yomi:event", h)
  },

  onStateChange(cb: (s: HotkeyState) => void): () => void {
    const h = (_: Electron.IpcRendererEvent, s: HotkeyState) => cb(s)
    ipcRenderer.on("yomi:state", h)
    return () => ipcRenderer.off("yomi:state", h)
  },

  // ── Audio ─────────────────────────────────────────────────────────────────

  sendAudioChunk(pcm: ArrayBuffer, sampleRate: number): void {
    ipcRenderer.send("yomi:audio-chunk", pcm, sampleRate)
  },

  setTts(enabled: boolean): void {
    ipcRenderer.send("yomi:set-tts", enabled)
  },

  // ── Window control ────────────────────────────────────────────────────────

  startDrag(offsetX: number, offsetY: number): void {
    ipcRenderer.send("yomi:drag-start", offsetX, offsetY)
  },

  moveDrag(screenX: number, screenY: number): void {
    ipcRenderer.send("yomi:drag-move", screenX, screenY)
  },

  resize(w: number, h: number): void {
    ipcRenderer.send("yomi:resize", w, h)
  },

  setMouseEventsIgnored(ignored: boolean): void {
    ipcRenderer.send("yomi:set-ignore-mouse-events", ignored)
  },

  setHitRegions(regions: { x: number; y: number; width: number; height: number }[]): void {
    ipcRenderer.send("yomi:set-hit-regions", regions)
  },

  nudge(dx: number, dy: number): void {
    ipcRenderer.send("yomi:nudge", dx, dy)
  },

  // ── Queries ───────────────────────────────────────────────────────────────

  submitTextQuery(text: string, attachmentB64?: string): void {
    ipcRenderer.send("yomi:text-query", text, attachmentB64 ?? null)
  },

  copyText(text: string): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke("yomi:copy-text", text)
  },

  // ── Subscription ──────────────────────────────────────────────────────────

  getSubscriptionInfo(): Promise<SubscriptionInfo | null> {
    return ipcRenderer.invoke("yomi:get-subscription-info")
  },

  updateProfileName(name: string): Promise<{ name: string; email: string }> {
    return ipcRenderer.invoke("yomi:update-profile-name", name)
  },

  onSubscriptionUpdate(cb: (info: SubscriptionUpdate) => void): () => void {
    const h = (_: Electron.IpcRendererEvent, info: SubscriptionUpdate) => cb(info)
    ipcRenderer.on("yomi:subscription-update", h)
    return () => ipcRenderer.off("yomi:subscription-update", h)
  },

  onStopAudio(cb: () => void): () => void {
    const h = () => cb()
    ipcRenderer.on("yomi:stop-audio", h)
    return () => ipcRenderer.off("yomi:stop-audio", h)
  },

  getDesktopSourceId(): Promise<string | null> {
    return ipcRenderer.invoke("yomi:get-desktop-source-id")
  },

  requestEscape(): void {
    ipcRenderer.send("yomi:escape")
  },

  triggerVoice(): void {
    ipcRenderer.send("yomi:trigger-voice")
  },

  triggerText(): void {
    ipcRenderer.send("yomi:trigger-text")
  },

  // One-click screen analysis straight into chat (no Enter).
  triggerAnalyze(): void {
    ipcRenderer.send("yomi:trigger-analyze")
  },

  stopListening(): void {
    ipcRenderer.send("yomi:stop-listening")
  },

  quit(): void {
    ipcRenderer.send("yomi:quit")
  },

  openUpgrade(): void {
    ipcRenderer.send("yomi:open-upgrade")
  },

  openDashboard(): void {
    ipcRenderer.send("yomi:open-dashboard")
  },

  openIntegrationsPage(): void {
    ipcRenderer.send("yomi:open-integrations")
  },

  pickAttachment(): Promise<{ path: string; b64: string } | null> {
    return ipcRenderer.invoke("yomi:pick-attachment")
  },

  // ── Auto-update ──────────────────────────────────────────────────────────

  onUpdateAvailable(cb: (info: { version: string; releaseDate: string }) => void): () => void {
    const h = (_: Electron.IpcRendererEvent, info: { version: string; releaseDate: string }) => cb(info)
    ipcRenderer.on("yomi:update-available", h)
    return () => ipcRenderer.off("yomi:update-available", h)
  },

  onUpdateDownloaded(cb: (info: { version: string }) => void): () => void {
    const h = (_: Electron.IpcRendererEvent, info: { version: string }) => cb(info)
    ipcRenderer.on("yomi:update-downloaded", h)
    return () => ipcRenderer.off("yomi:update-downloaded", h)
  },

  onUpdateProgress(cb: (info: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): () => void {
    const h = (_: Electron.IpcRendererEvent, info: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => cb(info)
    ipcRenderer.on("yomi:update-progress", h)
    return () => ipcRenderer.off("yomi:update-progress", h)
  },

  downloadUpdate(): void {
    ipcRenderer.send("yomi:download-update")
  },

  installUpdate(): void {
    ipcRenderer.send("yomi:install-update")
  },

  // ── Integrations ──────────────────────────────────────────────────────────

  getIntegrations(): Promise<{
    id: string
    provider: string
    displayName: string
    scopes: string[]
    connected: boolean
    lastSyncAt: string | null
    expiresAt: string | null
    createdAt: string
  }[]> {
    return ipcRenderer.invoke("yomi:get-integrations")
  },

  connectIntegration(id: string): Promise<{ ok?: boolean; error?: string; kind?: string }> {
    return ipcRenderer.invoke("yomi:connect-integration", id)
  },

  disconnectIntegration(provider: string): Promise<{ ok?: boolean; error?: string }> {
    return ipcRenderer.invoke("yomi:disconnect-integration", provider)
  },

  // ── Bot channels (Telegram) ─────────────────────────────────────────────────

  getBotConnections(): Promise<{ platform: string; connectedAt: string }[]> {
    return ipcRenderer.invoke("yomi:gateway-connections")
  },

  connectTelegramBot(): Promise<{ ok?: boolean; error?: string }> {
    return ipcRenderer.invoke("yomi:gateway-connect-telegram")
  },

  unlinkBot(platform: string): Promise<{ ok?: boolean; error?: string }> {
    return ipcRenderer.invoke("yomi:gateway-unlink", platform)
  },

  // ── Local management ───────────────────────────────────────────────────────

  getSessions(query?: string): Promise<unknown[]> {
    return ipcRenderer.invoke("yomi:get-sessions", query ?? "")
  },

  deleteSession(id: number): Promise<{ ok?: boolean; deleted?: boolean; error?: string }> {
    return ipcRenderer.invoke("yomi:delete-session", id)
  },

  getMemories(query?: string): Promise<unknown[]> {
    return ipcRenderer.invoke("yomi:get-memories", query ?? "")
  },

  addMemory(input: { content: string; topic?: string; kind?: string; scope?: string }): Promise<{ memory?: unknown; error?: string }> {
    return ipcRenderer.invoke("yomi:add-memory", input)
  },

  deleteMemory(id: string): Promise<{ ok?: boolean; error?: string }> {
    return ipcRenderer.invoke("yomi:delete-memory", id)
  },

  getSchedules(): Promise<unknown[]> {
    return ipcRenderer.invoke("yomi:get-schedules")
  },

  saveSchedule(input: { id?: string; schedule: string; prompt: string; deliverTo?: string[]; enabled?: boolean }): Promise<{ schedule?: unknown; error?: string }> {
    return ipcRenderer.invoke("yomi:save-schedule", input)
  },

  setScheduleEnabled(id: string, enabled: boolean): Promise<{ schedule?: unknown; error?: string }> {
    return ipcRenderer.invoke("yomi:set-schedule-enabled", id, enabled)
  },

  deleteSchedule(id: string): Promise<{ ok?: boolean; deleted?: boolean; error?: string }> {
    return ipcRenderer.invoke("yomi:delete-schedule", id)
  },

  getDiagnostics(): Promise<{ diagnostics?: unknown; logs?: string[]; error?: string }> {
    return ipcRenderer.invoke("yomi:get-diagnostics")
  },

  onUpdateError(cb: (info: { message: string }) => void): () => void {
    const h = (_: Electron.IpcRendererEvent, info: { message: string }) => cb(info)
    ipcRenderer.on("yomi:update-error", h)
    return () => ipcRenderer.off("yomi:update-error", h)
  },
})
