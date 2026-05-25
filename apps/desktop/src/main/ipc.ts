import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import type { SseEvent } from "@yomi/shared"
import { captureScreen } from "./capture"
import type { SidecarManager } from "./sidecar"
import { resetToIdle, activateProcessing } from "./hotkey"
import { BACKEND_URL, loadToken } from "./auth"

type Plan = "explore" | "pro" | "max"

let pcmChunks: Float32Array[] = []
let capturedSampleRate = 16000

// One controller covers the entire pipeline: screenshot/STT → sidecar SSE stream.
// Created at the top of each pipeline so ESC aborts any step, not just the fetch.
let pipelineCtrl: AbortController | null = null

function startPipeline(): AbortController {
  pipelineCtrl?.abort()           // cancel any in-flight pipeline
  const ctrl = new AbortController()
  pipelineCtrl = ctrl
  return ctrl
}

// Called by hotkey.ts onAbort (Escape during processing or listening).
export function abortCurrent(): void {
  pipelineCtrl?.abort()
  pipelineCtrl = null
  pcmChunks = []                  // discard any buffered voice chunks
}

// Registers sidecar-dependent IPC handlers. Called once after first auth.
export function initSidecarIpc(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
): { onListenStop: () => Promise<void>; onTextQuery: () => void; onAbort: () => void } {
  ipcMain.on("yomi:audio-chunk", (_e, pcm: ArrayBuffer, sampleRate: number) => {
    pcmChunks.push(new Float32Array(pcm))
    capturedSampleRate = sampleRate
  })

  // Text query: text-only output (no TTS)
  ipcMain.on("yomi:text-query", async (_e, text: string) => {
    if (!text?.trim()) { resetToIdle(); return }
    const ctrl = startPipeline()
    activateProcessing()
    try {
      const plan = await reserveInteraction(overlayWin, "chat", ctrl.signal)
      if (ctrl.signal.aborted) { resetToIdle(); return }
      const screenshotB64 = await captureScreen()
      if (ctrl.signal.aborted) { resetToIdle(); return }
      await streamQuery(sidecar, overlayWin, text.trim(), screenshotB64, false, plan, ctrl)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      send(overlayWin, { type: "error", message: err instanceof Error ? err.message : "Unknown error" })
      resetToIdle()
    }
  })

  return {
    // Voice query: STT → LLM → TTS
    onListenStop: async () => {
      const ctrl = startPipeline()
      const chunks = pcmChunks.splice(0)

      // Nothing recorded — user pressed stop immediately. Quietly reset.
      if (chunks.length === 0) { resetToIdle(); return }

      try {
        const plan = await reserveInteraction(overlayWin, "voice", ctrl.signal)
        if (ctrl.signal.aborted) return
        const wav = buildWav(chunks, capturedSampleRate)
        const [transcript, screenshotB64] = await Promise.all([
          transcribe(wav, sidecar, ctrl.signal),
          captureScreen(),
        ])
        if (ctrl.signal.aborted) return

        // STT returned silence/empty — quietly reset instead of showing an error.
        if (!transcript.trim()) { resetToIdle(); return }

        await streamQuery(sidecar, overlayWin, transcript, screenshotB64, true, plan, ctrl)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        send(overlayWin, { type: "error", message: err instanceof Error ? err.message : "Unknown error" })
        resetToIdle()
      }
    },
    onTextQuery: () => { /* state managed by hotkey.ts transition */ },
    onAbort: abortCurrent,
  }
}

function send(win: BrowserWindow, event: SseEvent): void {
  if (!win.isDestroyed()) win.webContents.send("yomi:event", event)
}

type ReserveResponse = {
  ok?: boolean
  error?: string
  plan?: Plan
  trialInteractionUsed?: number
  trialInteractionLimit?: number
  trialInteractionsRemaining?: number
  dailyChatUsed?: number
  dailyVoiceUsed?: number
}

type ReserveKind = "chat" | "voice"

async function reserveInteraction(win: BrowserWindow, kind: ReserveKind, signal: AbortSignal): Promise<Plan> {
  const token = loadToken()
  if (!token) throw new Error("Please sign in again")

  const res = await fetch(`${BACKEND_URL}/api/usage/interactions/reserve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind }),
    signal,
  })

  const data = await res.json().catch(() => ({})) as ReserveResponse
  if (!res.ok) {
    throw new Error(data.error ?? `Usage check failed (${res.status})`)
  }

  // Apply the reservation result immediately; the subscription fetch below is a DB-backed refresh.
  if (data.plan) {
    win.webContents.send("yomi:subscription-update", {
      plan: data.plan,
      trialInteractionUsed: data.trialInteractionUsed,
      trialInteractionLimit: data.trialInteractionLimit,
      trialInteractionsRemaining: data.trialInteractionsRemaining,
      dailyChatUsed: data.dailyChatUsed,
      dailyVoiceUsed: data.dailyVoiceUsed,
    })
  }

  const sub = await fetch(`${BACKEND_URL}/api/billing/subscription`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (sub.ok) {
    win.webContents.send("yomi:subscription-update", await sub.json())
  }
  return data.plan ?? "explore"
}

function buildWav(chunks: Float32Array[], sampleRate: number): Buffer {
  const MAX_SAMPLES = sampleRate * 30  // Sarvam STT hard limit: 30 s
  const rawTotal = chunks.reduce((s, c) => s + c.length, 0)
  const total = Math.min(rawTotal, MAX_SAMPLES)
  if (rawTotal > MAX_SAMPLES)
    console.warn(`[yomi/stt] audio trimmed to 30 s (recorded ${(rawTotal / sampleRate).toFixed(1)} s)`)
  const merged = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    if (off >= total) break
    const slice = off + c.length > total ? c.subarray(0, total - off) : c
    merged.set(slice, off); off += slice.length
  }

  const int16 = new Int16Array(total)
  for (let i = 0; i < total; i++)
    int16[i] = Math.max(-32768, Math.min(32767, (merged[i]! * 32768) | 0))

  const data = Buffer.from(int16.buffer)
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function transcribe(wav: Buffer, sidecar: SidecarManager, signal: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav")
  const res = await fetch(`${sidecar.baseUrl}/stt`, {
    method: "POST",
    headers: { "x-sidecar-secret": sidecar.secret },
    body: form,
    signal,
  })
  if (!res.ok) throw new Error(`Sidecar STT ${res.status}`)
  return ((await res.json()) as { text: string }).text
}

async function streamQuery(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
  text: string,
  screenshot_b64: string,
  tts: boolean,
  plan: Plan,
  ctrl: AbortController,
): Promise<void> {
  pipelineCtrl = ctrl   // keep reference current (startPipeline may have rotated it)

  const res = await fetch(`${sidecar.baseUrl}/query/fast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
    body: JSON.stringify({ text, screenshot_b64, mode: "answer", tts, plan }),
    signal: ctrl.signal,
  })
  if (!res.ok || !res.body) { pipelineCtrl = null; throw new Error(`Sidecar ${res.status}`) }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let sawDone = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()!
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const event = JSON.parse(line.slice(6)) as SseEvent
        send(overlayWin, event)
        if (event.type === "done")  { sawDone = true; resetToIdle() }
        if (event.type === "error") { sawDone = true; resetToIdle() }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") { resetToIdle(); return }
    throw err
  } finally {
    pipelineCtrl = null
  }

  if (!sawDone) resetToIdle()
}
