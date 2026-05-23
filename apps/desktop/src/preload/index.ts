import { contextBridge, ipcRenderer } from "electron"
import type { SseEvent } from "@yomi/shared"

type HotkeyState = "idle" | "listening" | "processing" | "text-input"
type AuthStatus = "ok" | "needed" | "waiting" | "error"

export interface SubscriptionInfo {
  role: string
  plan: string
  status: string
  trialEndDate: string | null
  currentPeriodEnd: string | null
  trialInteractionUsed: number
  trialInteractionLimit: number
  dailyChatUsed: number
  dailyVoiceUsed: number
  dailyImageUsed: number
  tokensUsedThisPeriod: number
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
    const onOk      = () => cb("ok")
    const onNeeded  = () => cb("needed")
    const onWaiting = () => cb("waiting")
    const onError   = (_: Electron.IpcRendererEvent, msg: string) => cb("error", msg)
    ipcRenderer.on("yomi:auth-ok",      onOk)
    ipcRenderer.on("yomi:auth-needed",  onNeeded)
    ipcRenderer.on("yomi:auth-waiting", onWaiting)
    ipcRenderer.on("yomi:auth-error",   onError)
    return () => {
      ipcRenderer.off("yomi:auth-ok",      onOk)
      ipcRenderer.off("yomi:auth-needed",  onNeeded)
      ipcRenderer.off("yomi:auth-waiting", onWaiting)
      ipcRenderer.off("yomi:auth-error",   onError)
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

  nudge(dx: number, dy: number): void {
    ipcRenderer.send("yomi:nudge", dx, dy)
  },

  // ── Queries ───────────────────────────────────────────────────────────────

  submitTextQuery(text: string): void {
    ipcRenderer.send("yomi:text-query", text)
  },

  // ── Subscription ──────────────────────────────────────────────────────────

  getSubscriptionInfo(): Promise<SubscriptionInfo> {
    return ipcRenderer.invoke("yomi:get-subscription-info")
  },

  onSubscriptionUpdate(cb: (info: SubscriptionInfo) => void): () => void {
    const h = (_: Electron.IpcRendererEvent, info: SubscriptionInfo) => cb(info)
    ipcRenderer.on("yomi:subscription-update", h)
    return () => ipcRenderer.off("yomi:subscription-update", h)
  },
})
