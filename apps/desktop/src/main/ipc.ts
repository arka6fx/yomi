import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import type { GuideElement, PointTarget, SseEvent } from "@yomi/shared"
import { captureScreen } from "./capture"
import type { ScreenCapture } from "./capture"
import { showGuideTarget, showGuideInstruction, hideGuidePoint } from "./guide-overlay"
import type { SidecarManager } from "./sidecar"
import { getHotkeyState, resetToIdle, activateProcessing, triggerStopListening, triggerVoiceMode } from "./hotkey"
import { BACKEND_URL, loadToken } from "./auth"
import { audioRms, GUIDE_SPEECH_RMS } from "./guide-audio"
import { mapGuideElementToScreen, mapPointTargetToScreen } from "./spatial-mapping"

let guideModeActive = false
let pointingModeActive = true
let hideGuideTimer: ReturnType<typeof setTimeout> | null = null
let guideSequenceTimers: ReturnType<typeof setTimeout>[] = []
let guideListenTimer: ReturnType<typeof setTimeout> | null = null
let guideListenTimeoutTimer: ReturnType<typeof setTimeout> | null = null
let guideSilenceTimer: ReturnType<typeof setTimeout> | null = null
let guideMaxSpeechTimer: ReturnType<typeof setTimeout> | null = null
let guideAutoListening = false
let guideSpeechStarted = false
let guideVoiceMs = 0
let activeGuideTask: string | null = null

const GUIDE_LISTEN_DELAY_MS = 2200
const GUIDE_NO_SPEECH_TIMEOUT_MS = 12000
const GUIDE_SILENCE_AFTER_SPEECH_MS = 900
const GUIDE_SPEECH_MIN_MS = 80
const GUIDE_MAX_AFTER_SPEECH_MS = 4500
const GUIDE_LISTEN_RETRY_MS = 250
const GUIDE_LISTEN_RETRIES = 10

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
  stopGuideAutoListening()
}

// Registers sidecar-dependent IPC handlers. Called once after first auth.
export function initSidecarIpc(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
): { onListenStop: () => Promise<void>; onTextQuery: () => void; onAbort: () => void } {
  ipcMain.on("yomi:guide-mode", (_e, on: boolean) => {
    guideModeActive = on
    if (!on) {
      clearGuideTimers()
      hideGuidePoint()
    }
  })

  ipcMain.on("yomi:pointing-mode", (_e, on: boolean) => {
    pointingModeActive = on
    if (!on && !guideModeActive) {
      clearGuideTimers()
      hideGuidePoint()
    }
  })

  ipcMain.on("yomi:audio-chunk", (_e, pcm: ArrayBuffer, sampleRate: number) => {
    const chunk = new Float32Array(pcm)
    pcmChunks.push(chunk)
    capturedSampleRate = sampleRate
    observeGuideAudio(chunk, sampleRate)
  })

  // Text query: text-only output (no TTS)
  ipcMain.on("yomi:text-query", async (_e, text: string) => {
    if (!text?.trim()) { resetToIdle(); return }
    const ctrl = startPipeline()
    activateProcessing()
    try {
      const plan = await reserveInteraction(overlayWin, "chat", ctrl.signal)
      if (ctrl.signal.aborted) { resetToIdle(); return }
      const capture = await captureScreen()
      if (ctrl.signal.aborted) { resetToIdle(); return }
      await streamQuery(sidecar, overlayWin, text.trim(), capture, false, plan, ctrl)
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
        const [transcript, capture] = await Promise.all([
          transcribe(wav, sidecar, ctrl.signal),
          captureScreen(),
        ])
        if (ctrl.signal.aborted) return

        // STT returned silence/empty — quietly reset instead of showing an error.
        if (!transcript.trim()) { resetToIdle(); return }

        await streamQuery(sidecar, overlayWin, transcript, capture, true, plan, ctrl)
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
  capture: ScreenCapture,
  tts: boolean,
  plan: Plan,
  ctrl: AbortController,
): Promise<void> {
  pipelineCtrl = ctrl   // keep reference current (startPipeline may have rotated it)
  clearGuideTimers()
  hideGuidePoint()      // clear any stale dot from the previous query
  let persistentPointShown = false
  let guideSequenceMs = 0
  const guidedNavigation = guideModeActive || shouldUseGuidedNavigation(text) || shouldContinueGuide(text)
  const queryText = guidedNavigation ? buildGuideQuery(text) : text
  if (guidedNavigation) {
    showGuideInstruction("Finding the next step on this screen...", 1, 1)
    persistentPointShown = true
  }

  const res = await fetch(`${sidecar.baseUrl}/query/fast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
    body: JSON.stringify({
      text: queryText,
      screenshot_b64: capture.screenshot_b64,
      screenshots: capture.displays.map(({ screen, screenshot_b64, imageWidth, imageHeight, isCursorScreen }) => ({
        screen,
        screenshot_b64,
        width: imageWidth,
        height: imageHeight,
        is_cursor_screen: isCursorScreen,
      })),
      mode: "answer",
      pointing: pointingModeActive,
      tts,
      plan,
    }),
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
        if (event.type === "visual_guide") {
          guideSequenceMs = scheduleVisualGuideEvent(event, capture, overlayWin)
          persistentPointShown = true
          continue
        } else {
          send(overlayWin, event)
        }
        if (event.type === "point_target") {
          if (pointingModeActive && event.target) {
            showPointTarget(event.target, capture)
            persistentPointShown = true
          }
          else if (!guideModeActive) hideGuidePoint()
        }
        if (event.type === "done")  {
          sawDone = true
          if (persistentPointShown) scheduleGuideHide(guideSequenceMs)
          else hideGuidePoint()
          resetToIdle()
          if (guidedNavigation) scheduleGuideListening()
        }
        if (event.type === "error") { sawDone = true; hideGuidePoint(); resetToIdle() }
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

function clearGuideTimers(): void {
  if (hideGuideTimer) {
    clearTimeout(hideGuideTimer)
    hideGuideTimer = null
  }
  stopGuideAutoListening()
  for (const timer of guideSequenceTimers) clearTimeout(timer)
  guideSequenceTimers = []
}

function clearGuideListenTimers(): void {
  if (guideListenTimer) {
    clearTimeout(guideListenTimer)
    guideListenTimer = null
  }
  if (guideListenTimeoutTimer) {
    clearTimeout(guideListenTimeoutTimer)
    guideListenTimeoutTimer = null
  }
  if (guideSilenceTimer) {
    clearTimeout(guideSilenceTimer)
    guideSilenceTimer = null
  }
  if (guideMaxSpeechTimer) {
    clearTimeout(guideMaxSpeechTimer)
    guideMaxSpeechTimer = null
  }
}

function scheduleGuideHide(afterMs = 0): void {
  if (hideGuideTimer) clearTimeout(hideGuideTimer)
  hideGuideTimer = setTimeout(() => {
    hideGuideTimer = null
    hideGuidePoint()
  }, afterMs + 6500)
}

function scheduleGuideListening(): void {
  clearGuideListenTimers()
  if (!pointingModeActive || !activeGuideTask) return
  guideListenTimer = setTimeout(() => {
    guideListenTimer = null
    startGuideListeningAttempt(0)
  }, GUIDE_LISTEN_DELAY_MS)
}

function startGuideListeningAttempt(attempt: number): void {
  if (!pointingModeActive || !activeGuideTask) return
  if (getHotkeyState() !== "idle") {
    if (attempt >= GUIDE_LISTEN_RETRIES) {
      showGuideInstruction('Say "next step" when ready.', 1, 1)
      return
    }
    guideListenTimer = setTimeout(() => {
      guideListenTimer = null
      startGuideListeningAttempt(attempt + 1)
    }, GUIDE_LISTEN_RETRY_MS)
    return
  }

  const started = triggerVoiceMode()
  if (!started || getHotkeyState() !== "listening") {
    if (attempt >= GUIDE_LISTEN_RETRIES) {
      showGuideInstruction('Say "next step" when ready.', 1, 1)
      return
    }
    guideListenTimer = setTimeout(() => {
      guideListenTimer = null
      startGuideListeningAttempt(attempt + 1)
    }, GUIDE_LISTEN_RETRY_MS)
    return
  }

  guideAutoListening = true
  guideSpeechStarted = false
  guideVoiceMs = 0
  pcmChunks = []
  showGuideInstruction('Listening for next step...', 1, 1)
  guideListenTimeoutTimer = setTimeout(() => {
    stopGuideAutoListening()
    pcmChunks = []
    resetToIdle()
    showGuideInstruction('Say "next step" when ready.', 1, 1)
    scheduleGuideHide()
  }, GUIDE_NO_SPEECH_TIMEOUT_MS)
}

function stopGuideAutoListening(): void {
  clearGuideListenTimers()
  guideAutoListening = false
  guideSpeechStarted = false
  guideVoiceMs = 0
}

function observeGuideAudio(chunk: Float32Array, sampleRate: number): void {
  if (!guideAutoListening) return
  const rms = audioRms(chunk)
  if (rms >= GUIDE_SPEECH_RMS) {
    guideVoiceMs += (chunk.length / Math.max(sampleRate, 1)) * 1000
    if (guideVoiceMs >= GUIDE_SPEECH_MIN_MS) {
      guideSpeechStarted = true
      if (!guideMaxSpeechTimer) {
        guideMaxSpeechTimer = setTimeout(() => {
          stopGuideAutoListening()
          triggerStopListening()
        }, GUIDE_MAX_AFTER_SPEECH_MS)
      }
    }
    if (guideSilenceTimer) {
      clearTimeout(guideSilenceTimer)
      guideSilenceTimer = null
    }
    return
  }
  if (!guideSpeechStarted || guideSilenceTimer) return
  guideSilenceTimer = setTimeout(() => {
    stopGuideAutoListening()
    triggerStopListening()
  }, GUIDE_SILENCE_AFTER_SPEECH_MS)
}

function shouldUseGuidedNavigation(text: string): boolean {
  if (!pointingModeActive) return false
  return /\b(step by step|guide me|show me how|how (do|to|can) i|where (do|should) i click|what (do|should) i click|directions?|navigate|save (my )?(project|file|work)|click first)\b/i.test(text)
}

function shouldContinueGuide(text: string): boolean {
  if (!pointingModeActive || !activeGuideTask) return false
  return /\b(continue|next( step)?|done|i did it|did it|go on|guide me further|where next|what next|what do i do next|where do i go next|show me the next step|next please|okay next|ok next)\b/i.test(text.trim())
}

function buildGuideQuery(text: string): string {
  if (shouldContinueGuide(text) && activeGuideTask) {
    return `Continue guiding me through this task: ${activeGuideTask}. I completed the previous step. Give only the next actionable step visible on the current screenshot. If there is a visible UI target, point at it. If the best action is a keyboard shortcut, say the shortcut.`
  }
  activeGuideTask = text.trim()
  return `${text.trim()}\n\nGive only the next actionable step visible on the current screenshot. If there is a visible UI target, point at it. If the best action is a keyboard shortcut, say the shortcut.`
}

function scheduleVisualGuideEvent(event: Extract<SseEvent, { type: "visual_guide" }>, capture: ScreenCapture, win: BrowserWindow): number {
  const delay = Math.max(0, event.step - 1) * 5200
  const timer = setTimeout(() => {
    send(win, event)
    showVisualGuideTarget(event.elements?.[0], capture, event.step, event.total_steps, event.instruction)
  }, delay)
  guideSequenceTimers.push(timer)
  return delay
}

function showVisualGuideTarget(
  element: GuideElement | undefined,
  capture: ScreenCapture,
  step = 1,
  total = 1,
  instruction?: string,
): void {
  const point = mapGuideElementToScreen(element, capture)
  const label = instruction ?? point?.label ?? "Follow this step"
  const guidedLabel = `${label}  Say "next" when done.`
  if (!point) {
    showGuideInstruction(guidedLabel, step, total)
    return
  }
  showGuideTarget(point.x, point.y, `Click this: ${guidedLabel}`, step, total)
}

function showPointTarget(target: PointTarget, capture: ScreenCapture): void {
  const point = mapPointTargetToScreen(target, capture)
  if (!point) return
  showGuideTarget(point.x, point.y, `Click this: ${point.label}`)
}
