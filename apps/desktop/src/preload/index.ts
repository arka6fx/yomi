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
  trialInteractionUsed: number
  trialInteractionLimit: number
  trialInteractionsRemaining: number
  dailyChatUsed: number
  dailyVoiceUsed: number
  dailyImageUsed: number
  tokensUsedThisPeriod: number
}

export type SubscriptionUpdate = Partial<SubscriptionInfo> & {
  plan?: string
}

export interface AutomationProviderHealth {
  id: string
  label: string
  ok: boolean
  detail?: string
  diagnostics?: Record<string, unknown>
}

export interface AutomationHealthResponse {
  ok: boolean
  providers: AutomationProviderHealth[]
}

export interface AutomationProviderRepairResponse {
  provider: AutomationProviderHealth
}

export interface AutomationKnowledgeWorkflow {
  id: string
  agentId: string
  goal: string
  tools: string[]
  stepCount: number
  recoveryCount: number
  durationMs: number
  outcome: "success" | "failure"
  summary: string
  createdAt: string
}

export interface AutomationKnowledgeRecovery {
  id: string
  agentId: string
  goalKey: string
  error: string
  strategy: string
  createdAt: string
}

export interface AutomationKnowledgeResponse {
  agent: { id: string; label: string; provider: string }
  hint: string | null
  workflows: AutomationKnowledgeWorkflow[]
  recoveries: AutomationKnowledgeRecovery[]
}

export interface AutomationWorkflowReplay {
  replayId: string
  task: string
  ownerId: string
  ownerLabel: string
  status: string
  startedAt: string
  endedAt: string | null
  summary: string | null
}

export interface AutomationWorkflowsResponse {
  workflows: AutomationWorkflowReplay[]
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

  submitTextQuery(text: string): void {
    ipcRenderer.send("yomi:text-query", text)
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

  // Hands-free loop: main asks the renderer to re-listen for the next task.
  onLoopContinue(cb: () => void): () => void {
    const h = () => cb()
    ipcRenderer.on("yomi:loop-continue", h)
    return () => ipcRenderer.off("yomi:loop-continue", h)
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
  triggerScreenshot(): void {
    ipcRenderer.send("yomi:trigger-screenshot")
  },

  stopListening(): void {
    ipcRenderer.send("yomi:stop-listening")
  },

  // Barge-in: user spoke while Yomi was processing/speaking — abort the current
  // turn and start listening for the new request.
  bargeIn(): void {
    ipcRenderer.send("yomi:barge-in")
  },

  quit(): void {
    ipcRenderer.send("yomi:quit")
  },

  openUpgrade(): void {
    ipcRenderer.send("yomi:open-upgrade")
  },

  setOpacity(value: number): void {
    ipcRenderer.send("yomi:set-opacity", value)
  },

  confirmAct(id: string, approved: boolean): void {
    ipcRenderer.send("yomi:act-confirm", id, approved)
  },

  replayAutomation(replayId: string): void {
    ipcRenderer.send("yomi:automation-replay", replayId)
  },

  getAutomationHealth(): Promise<AutomationHealthResponse> {
    return ipcRenderer.invoke("yomi:automation-health")
  },

  repairAutomationProvider(providerId: string): Promise<AutomationProviderRepairResponse> {
    return ipcRenderer.invoke("yomi:automation-provider-repair", providerId)
  },

  getAutomationKnowledge(goal: string): Promise<AutomationKnowledgeResponse> {
    return ipcRenderer.invoke("yomi:automation-knowledge", goal)
  },

  getAutomationWorkflows(): Promise<AutomationWorkflowsResponse> {
    return ipcRenderer.invoke("yomi:automation-workflows")
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

  downloadUpdate(): void {
    ipcRenderer.send("yomi:download-update")
  },

  installUpdate(): void {
    ipcRenderer.send("yomi:install-update")
  },
})
