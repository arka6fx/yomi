import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import type { GuideElement, PointTarget, SseEvent } from "@yomi/shared"
import { captureScreen } from "./capture"
import type { ScreenCapture } from "./capture"
import { showGuideTarget, showGuideInstruction, hideGuidePoint } from "./guide-overlay"
import type { SidecarManager } from "./sidecar"
import { getHotkeyState, resetToIdle, activateProcessing } from "./hotkey"
import { BACKEND_URL, loadToken } from "./auth"
import { mapGuideElementToScreen, mapPointTargetToScreen } from "./spatial-mapping"

// Guide overlay is driven by the renderer's guide UI; act/pointing are decided per-turn from
// what the user said (no manual toggles). Pointing targets always render when the model emits one.
// The mic only ever opens on the Voice button / Ctrl+Space — nothing here re-arms listening.
let guideModeActive = false
let hideGuideTimer: ReturnType<typeof setTimeout> | null = null
let guideSequenceTimers: ReturnType<typeof setTimeout>[] = []
let activeGuideTask: string | null = null
// Conversation history for multi-turn act commands, sent with each agent query for context.
let actHistory: { role: "user" | "assistant"; text: string }[] = []
const ACT_HISTORY_MAX = 16 // last 8 turns (user + assistant each)

type Plan = "explore" | "pro" | "max"

// Screen-analysis prompt for the Screenshot button / Ctrl+S. The chat shows SCREEN_LABEL instead.
const SCREEN_PROMPT = `Analyze what's on my screen and use the standard answer-block format.

If you see a CODING or ALGORITHM problem, respond in exactly this structure:

[short introduction to the problem and approach]

\`\`\`python
# complete solution — use Python unless the problem or visible code specifies another language
\`\`\`

Time: O(?) — one-line reason
Space: O(?) — one-line reason

Example: include useful examples from the screen when they are visible.

If you see a MULTIPLE CHOICE QUESTION (MCQ) or a question with a single definite answer, respond in exactly this structure:

[1-3 sentence explanation of why the answer is correct]

\`\`\`answer
[letter and answer text, e.g. "B. The mitochondria"]
\`\`\`

If you see a writing task, briefly state what you drafted, then put the exact copy-ready response in an answer block:

\`\`\`answer
[the actual written response]
\`\`\`

For applications and letters, use proper letter format: date, recipient, subject, salutation, body paragraphs, closing, and sender name when appropriate.
For biographies or long paragraph answers, use a clear title, sections, and readable paragraphs. Make it complete without padding.

If there is no question, describe what's on the screen concisely and put the main takeaway in an answer block.`
const SCREEN_LABEL = "Analyze my screen"

let pcmChunks: Float32Array[] = []
let capturedSampleRate = 16000

// One controller covers the entire pipeline: screenshot/STT → sidecar SSE stream.
// Created at the top of each pipeline so ESC aborts any step, not just the fetch.
let pipelineCtrl: AbortController | null = null

function startPipeline(): AbortController {
  pipelineCtrl?.abort() // cancel any in-flight pipeline
  const ctrl = new AbortController()
  pipelineCtrl = ctrl
  return ctrl
}

// Called by hotkey.ts onAbort (Escape during processing or listening).
export function abortCurrent(): void {
  pipelineCtrl?.abort()
  pipelineCtrl = null
  pcmChunks = [] // discard any buffered voice chunks
  actHistory = [] // drop the multi-turn act context too
}

// Registers sidecar-dependent IPC handlers. Called once after first auth.
export function initSidecarIpc(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
): {
  onListenStop: () => Promise<void>
  onTextQuery: () => void
  onAbort: () => void
  onScreenshot: () => Promise<void>
} {
  ipcMain.on("yomi:guide-mode", (_e, on: boolean) => {
    guideModeActive = on
    if (!on) {
      clearGuideTimers()
      hideGuidePoint()
    }
  })

  // Forward the user's confirm/cancel for a risky action back to the sidecar (Spec 16).
  ipcMain.on("yomi:act-confirm", async (_e, id: string, approved: boolean) => {
    try {
      await fetch(`${sidecar.baseUrl}/act/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
        body: JSON.stringify({ id, approved }),
      })
    } catch (err) {
      console.error("[yomi/act] confirm failed", err)
    }
  })

  ipcMain.on("yomi:audio-chunk", (_e, pcm: ArrayBuffer, sampleRate: number) => {
    pcmChunks.push(new Float32Array(pcm))
    capturedSampleRate = sampleRate
  })

  // Text query: text-only output (no TTS)
  ipcMain.on("yomi:text-query", async (_e, text: string) => {
    if (!text?.trim()) {
      resetToIdle()
      return
    }
    const ctrl = startPipeline()
    activateProcessing()
    try {
      const plan = await reserveInteraction(overlayWin, "chat", ctrl.signal)
      if (ctrl.signal.aborted) {
        resetToIdle()
        return
      }
      const capture = await captureScreen()
      if (ctrl.signal.aborted) {
        resetToIdle()
        return
      }
      await streamQuery(sidecar, overlayWin, text.trim(), capture, false, plan, ctrl)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      send(overlayWin, {
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      })
      resetToIdle()
    }
  })

  // Capture the screen and stream a screen analysis straight into chat (no Enter).
  // Shared by the Screenshot toolbar button and its global hotkey.
  const runScreenshot = async (): Promise<void> => {
    if (getHotkeyState() !== "idle") return
    const ctrl = startPipeline()
    activateProcessing()
    try {
      const plan = await reserveInteraction(overlayWin, "chat", ctrl.signal)
      if (ctrl.signal.aborted) {
        resetToIdle()
        return
      }
      const capture = await captureScreen()
      if (ctrl.signal.aborted) {
        resetToIdle()
        return
      }
      // transcriptLabel keeps the verbose prompt out of chat; forceAnswer skips intent routing
      // (so words inside the prompt can't misroute it to the agent) and never re-arms the mic.
      await streamQuery(
        sidecar,
        overlayWin,
        SCREEN_PROMPT,
        capture,
        false,
        plan,
        ctrl,
        SCREEN_LABEL,
        true,
      )
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      send(overlayWin, {
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      })
      resetToIdle()
    }
  }
  ipcMain.on("yomi:trigger-screenshot", () => {
    void runScreenshot()
  })

  return {
    // Voice query: STT → LLM → TTS
    onListenStop: async () => {
      const ctrl = startPipeline()
      const chunks = pcmChunks.splice(0)

      // Nothing recorded — user pressed stop immediately. Quietly reset.
      if (chunks.length === 0) {
        resetToIdle()
        return
      }

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
        if (!transcript.trim()) {
          resetToIdle()
          return
        }

        await streamQuery(sidecar, overlayWin, transcript, capture, true, plan, ctrl)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        send(overlayWin, {
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        })
        resetToIdle()
      }
    },
    onTextQuery: () => {
      /* state managed by hotkey.ts transition */
    },
    onAbort: abortCurrent,
    onScreenshot: runScreenshot,
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

async function reserveInteraction(
  win: BrowserWindow,
  kind: ReserveKind,
  signal: AbortSignal,
): Promise<Plan> {
  const token = loadToken()
  if (!token) throw new Error("Please sign in again")

  const res = await fetch(`${BACKEND_URL}/api/usage/interactions/reserve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind }),
    signal,
  })

  const data = (await res.json().catch(() => ({}))) as ReserveResponse
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
  const MAX_SAMPLES = sampleRate * 30 // Sarvam STT hard limit: 30 s
  const rawTotal = chunks.reduce((s, c) => s + c.length, 0)
  const total = Math.min(rawTotal, MAX_SAMPLES)
  if (rawTotal > MAX_SAMPLES)
    console.warn(
      `[yomi/stt] audio trimmed to 30 s (recorded ${(rawTotal / sampleRate).toFixed(1)} s)`,
    )
  const merged = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    if (off >= total) break
    const slice = off + c.length > total ? c.subarray(0, total - off) : c
    merged.set(slice, off)
    off += slice.length
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

async function transcribe(
  wav: Buffer,
  sidecar: SidecarManager,
  signal: AbortSignal,
): Promise<string> {
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
  transcriptLabel?: string, // shown in chat instead of `text` (e.g. for the Screenshot button)
  forceAnswer = false, // skip all intent routing — always the fast screen-answer path
): Promise<void> {
  pipelineCtrl = ctrl // keep reference current (startPipeline may have rotated it)
  clearGuideTimers()
  hideGuidePoint() // clear any stale dot from the previous query
  let persistentPointShown = false
  let guideSequenceMs = 0
  // The mode is decided purely from what the user said — no manual toggles.
  const guidedNavigation =
    !forceAnswer &&
    (guideModeActive || shouldUseGuidedNavigation(text) || shouldContinueGuide(text))

  // "…in the background" → spawn a detached, autonomous agent surfaced in the companion dock,
  // then free the toolbar immediately so the user can keep talking.
  if (!forceAnswer && !guidedNavigation && shouldUseBackground(text)) {
    pipelineCtrl = null
    startBackgroundRun(sidecar, overlayWin, stripBackgroundPhrase(text), capture, plan)
    resetToIdle()
    return
  }

  // Imperative/desktop commands route to the agent (it has the UIA tools). Guidance wins ties.
  const useAgent =
    !forceAnswer && !guidedNavigation && (shouldUseSystemAction(text) || shouldUseAgent(text))
  const queryText = guidedNavigation ? buildGuideQuery(text) : text
  if (guidedNavigation) {
    showGuideInstruction("Finding the next step on this screen...", 1, 1)
    persistentPointShown = true
  }

  // Interactive actions are hands-free: no chat transcript unless an error/confirmation needs UI.

  const endpoint = useAgent ? "/query/agent" : "/query/fast"
  const body = useAgent
    ? { text: queryText, screenshot_b64: capture.screenshot_b64, plan, history: actHistory.slice() }
    : {
        text: queryText,
        screenshot_b64: capture.screenshot_b64,
        screenshots: capture.displays.map(
          ({ screen, screenshot_b64, imageWidth, imageHeight, isCursorScreen }) => ({
            screen,
            screenshot_b64,
            width: imageWidth,
            height: imageHeight,
            is_cursor_screen: isCursorScreen,
          }),
        ),
        mode: "answer",
        pointing: true,
        tts,
        plan,
      }

  const res = await fetch(`${sidecar.baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  })
  if (!res.ok || !res.body) {
    pipelineCtrl = null
    throw new Error(`Sidecar ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let sawDone = false
  let agentTextBuf = "" // accumulate the agent's reply to store in the Act loop history

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
        if (event.type === "agent_text") agentTextBuf += event.text
        // Show a short label in chat instead of a long synthetic prompt (e.g. screen analysis).
        if (event.type === "transcript" && transcriptLabel) event.text = transcriptLabel
        if (event.type === "visual_guide") {
          guideSequenceMs = scheduleVisualGuideEvent(event, capture, overlayWin)
          persistentPointShown = true
          continue
        } else if (!useAgent || shouldShowInteractiveEvent(event)) {
          send(overlayWin, event)
        }
        if (event.type === "point_target") {
          if (event.target) {
            showPointTarget(event.target, capture)
            persistentPointShown = true
          } else if (!guideModeActive) hideGuidePoint()
        }
        if (event.type === "done") {
          sawDone = true
          if (persistentPointShown) scheduleGuideHide(guideSequenceMs)
          else hideGuidePoint()
          // Record this agent turn so a follow-up command (on a manual Voice press) has context.
          if (useAgent) pushActTurn(text, agentTextBuf)
          resetToIdle()
        }
        if (event.type === "error") {
          sawDone = true
          hideGuidePoint()
          resetToIdle()
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      resetToIdle()
      return
    }
    throw err
  } finally {
    pipelineCtrl = null
  }

  if (!sawDone) resetToIdle()
}

// ── Background agents ──────────────────────────────────────────────────────────
// "…in the background" tasks run autonomously, detached from the foreground pipeline (their own
// AbortController), so they survive the user starting another query. Progress surfaces in the
// companion dock via the `yomi:background-agent` channel — one dock entry per runId.
let backgroundSeq = 0
let backgroundRunCounter = 0

type BackgroundUpdate = {
  state: "idle" | "thinking" | "working" | "waiting" | "error"
  task: string
  step?: number
  max?: number
  done?: boolean
}

function startBackgroundRun(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
  task: string,
  capture: ScreenCapture,
  plan: Plan,
): void {
  const runId = `bg-${++backgroundRunCounter}`
  const ctrl = new AbortController()
  const sendBg = (u: BackgroundUpdate): void => {
    if (!overlayWin.isDestroyed()) {
      overlayWin.webContents.send("yomi:background-agent", { seq: ++backgroundSeq, runId, ...u })
    }
  }

  sendBg({ state: "thinking", task })

  void (async () => {
    try {
      const res = await fetch(`${sidecar.baseUrl}/query/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
        body: JSON.stringify({ text: task, screenshot_b64: capture.screenshot_b64, plan }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        sendBg({ state: "error", task, done: true })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop()!
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const event = JSON.parse(line.slice(6)) as SseEvent
          if (event.type === "agent_step")
            sendBg({ state: "working", task, step: event.iteration, max: event.max })
          else if (event.type === "done") sendBg({ state: "idle", task, done: true })
          else if (event.type === "error") sendBg({ state: "error", task, done: true })
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") sendBg({ state: "error", task, done: true })
    }
  })()
}

function clearGuideTimers(): void {
  if (hideGuideTimer) {
    clearTimeout(hideGuideTimer)
    hideGuideTimer = null
  }
  for (const timer of guideSequenceTimers) clearTimeout(timer)
  guideSequenceTimers = []
}

function scheduleGuideHide(afterMs = 0): void {
  if (hideGuideTimer) clearTimeout(hideGuideTimer)
  hideGuideTimer = setTimeout(() => {
    hideGuideTimer = null
    hideGuidePoint()
  }, afterMs + 6500)
}

// Append a completed agent turn to the rolling history (used for follow-up commands on a manual press).
function pushActTurn(userText: string, assistantText: string): void {
  actHistory.push({ role: "user", text: userText.trim() })
  actHistory.push({ role: "assistant", text: assistantText.trim() || "(done)" })
  if (actHistory.length > ACT_HISTORY_MAX) actHistory = actHistory.slice(-ACT_HISTORY_MAX)
}

// "Guide me" intent → visual step-by-step pointing on the user's screen.
function shouldUseGuidedNavigation(text: string): boolean {
  return /\b(step by step|guide me|show me how|how (do|to|can) i|where (do|should) i click|what (do|should) i click|directions?|navigate|save (my )?(project|file|work)|click first)\b/i.test(
    text,
  )
}

// "…in the background" intent → detached autonomous agent surfaced in the companion dock.
function shouldUseBackground(text: string): boolean {
  return /\b(in the background|in background|in the bg|in bg)\b/i.test(text)
}

// Strip the "in the background" framing so the agent receives a clean task.
function stripBackgroundPhrase(text: string): string {
  return (
    text
      .replace(/\b(in the background|in background|in the bg|in bg)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() || text.trim()
  )
}

// Imperative UI commands → desktop automation tasks for the agent (Spec 16).
function shouldUseAgent(text: string): boolean {
  return /\b(open|click|press|type|enter|fill|select|choose|check|uncheck|toggle|close|switch|go to|navigate|delete|send|save|copy|paste|rename|create|run|play|pause|resume|spotify|volume|sound|audio|louder|quieter|mute|unmute|increase|decrease|lower|raise|inc|dec)\b/i.test(
    text,
  )
}

function shouldUseSystemAction(text: string): boolean {
  return (
    /\b(volume|sound|audio|song|louder|quieter|mute|unmute|increase|decrease|lower|raise|inc|dec|spotify)\b/i.test(
      text,
    ) || /\bplay\b.+\b(song|track|music|by)\b/i.test(text)
  )
}

function shouldShowInteractiveEvent(event: SseEvent): boolean {
  return event.type === "act_proposed" || event.type === "error"
}

function shouldContinueGuide(text: string): boolean {
  if (!activeGuideTask) return false
  return /\b(continue|next( step)?|done|i did it|did it|go on|guide me further|where next|what next|what do i do next|where do i go next|show me the next step|next please|okay next|ok next)\b/i.test(
    text.trim(),
  )
}

function buildGuideQuery(text: string): string {
  if (shouldContinueGuide(text) && activeGuideTask) {
    return `Continue guiding me through this task: ${activeGuideTask}. I completed the previous step. Give only the next actionable step visible on the current screenshot. If there is a visible UI target, point at it. If the best action is a keyboard shortcut, say the shortcut.`
  }
  activeGuideTask = text.trim()
  return `${text.trim()}\n\nGive only the next actionable step visible on the current screenshot. If there is a visible UI target, point at it. If the best action is a keyboard shortcut, say the shortcut.`
}

function scheduleVisualGuideEvent(
  event: Extract<SseEvent, { type: "visual_guide" }>,
  capture: ScreenCapture,
  win: BrowserWindow,
): number {
  const delay = Math.max(0, event.step - 1) * 5200
  const timer = setTimeout(() => {
    send(win, event)
    showVisualGuideTarget(
      event.elements?.[0],
      capture,
      event.step,
      event.total_steps,
      event.instruction,
    )
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
