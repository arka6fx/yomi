import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import type { SseEvent } from "@yomi/shared"
import { captureScreen } from "./capture"
import type { ScreenCapture } from "./capture"
import type { SidecarManager } from "./sidecar"
import {
  getHotkeyState,
  resetToIdle,
  activateProcessing,
  endVoiceTurn,
  bargeInToListening,
} from "./hotkey"
import { BACKEND_URL, loadToken } from "./auth"

// The mic only ever opens on the Voice button / Ctrl+Space — nothing here re-arms listening.
// Conversation history for multi-turn act commands, sent with each agent query for context.
let actHistory: { role: "user" | "assistant"; text: string }[] = []
const ACT_HISTORY_MAX = 16 // last 8 turns (user + assistant each)

type Plan = "explore" | "pro" | "max"

type AutomationProviderHealth = {
  id: string
  label: string
  ok: boolean
  detail?: string
  diagnostics?: Record<string, unknown>
}

type AutomationHealthResponse = {
  ok: boolean
  providers: AutomationProviderHealth[]
}

type AutomationProviderRepairResponse = {
  provider: AutomationProviderHealth
}

type AutomationKnowledgeResponse = {
  agent: { id: string; label: string; provider: string }
  hint: string | null
  workflows: {
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
  }[]
  recoveries: {
    id: string
    agentId: string
    goalKey: string
    error: string
    strategy: string
    createdAt: string
  }[]
}

type AutomationWorkflowReplay = {
  replayId: string
  task: string
  ownerId: string
  ownerLabel: string
  status: string
  startedAt: string
  endedAt: string | null
  summary: string | null
}

type AutomationWorkflowsResponse = {
  workflows: AutomationWorkflowReplay[]
}

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
// True only while a barge-in abort is in flight, so streamQuery's AbortError
// branch doesn't reset to idle and stomp the fresh listening state.
let bargingIn = false
let agentAutomationFocusSuppressed = false

function startPipeline(): AbortController {
  pipelineCtrl?.abort() // cancel any in-flight pipeline
  bargingIn = false
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
  ipcMain.removeHandler("yomi:automation-health")
  ipcMain.handle("yomi:automation-health", async (): Promise<AutomationHealthResponse> => {
    const res = await fetch(`${sidecar.baseUrl}/automation/health`, {
      headers: { "x-sidecar-secret": sidecar.secret },
    })
    const body = (await res.json().catch(() => ({}))) as Partial<AutomationHealthResponse> & {
      error?: string
    }
    if (!res.ok) throw new Error(body.error ?? `Automation health ${res.status}`)
    return { ok: body.ok === true, providers: body.providers ?? [] }
  })
  ipcMain.removeHandler("yomi:automation-provider-repair")
  ipcMain.handle(
    "yomi:automation-provider-repair",
    async (_event, providerId: string): Promise<AutomationProviderRepairResponse> => {
      if (!providerId) throw new Error("Provider id required")
      const res = await fetch(`${sidecar.baseUrl}/automation/providers/${providerId}/repair`, {
        method: "POST",
        headers: { "x-sidecar-secret": sidecar.secret },
      })
      const body = (await res.json().catch(() => ({}))) as Partial<AutomationProviderRepairResponse> & {
        error?: string
      }
      if (!res.ok || !body.provider) {
        throw new Error(body.error ?? `Automation provider repair ${res.status}`)
      }
      return { provider: body.provider }
    },
  )
  ipcMain.removeHandler("yomi:automation-knowledge")
  ipcMain.handle("yomi:automation-knowledge", async (_event, goal: string): Promise<AutomationKnowledgeResponse> => {
    const trimmed = goal?.trim()
    if (!trimmed) throw new Error("Goal required")
    const res = await fetch(
      `${sidecar.baseUrl}/automation/knowledge?goal=${encodeURIComponent(trimmed)}`,
      {
        headers: { "x-sidecar-secret": sidecar.secret },
      },
    )
    const body = (await res.json().catch(() => ({}))) as Partial<AutomationKnowledgeResponse> & {
      error?: string
    }
    if (!res.ok || !body.agent) throw new Error(body.error ?? `Automation knowledge ${res.status}`)
    return {
      agent: body.agent,
      hint: body.hint ?? null,
      workflows: body.workflows ?? [],
      recoveries: body.recoveries ?? [],
    }
  })
  ipcMain.removeHandler("yomi:automation-workflows")
  ipcMain.handle("yomi:automation-workflows", async (): Promise<AutomationWorkflowsResponse> => {
    const res = await fetch(`${sidecar.baseUrl}/automation/workflows?limit=8`, {
      headers: { "x-sidecar-secret": sidecar.secret },
    })
    const body = (await res.json().catch(() => ({}))) as Partial<AutomationWorkflowsResponse> & {
      error?: string
    }
    if (!res.ok) throw new Error(body.error ?? `Automation workflows ${res.status}`)
    return { workflows: body.workflows ?? [] }
  })

  // Forward the user's confirm/cancel for a risky action back to the sidecar (Spec 16).
  ipcMain.on("yomi:act-confirm", async (_e, id: string, approved: boolean) => {
    try {
      await fetch(`${sidecar.baseUrl}/act/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
        body: JSON.stringify({ id, approved }),
      })
      if (agentAutomationFocusSuppressed && !overlayWin.isDestroyed()) {
        overlayWin.blur()
        overlayWin.setFocusable(false)
      }
    } catch (err) {
      console.error("[yomi/act] confirm failed", err)
    }
  })

  ipcMain.on("yomi:automation-replay", async (_e, replayId: string) => {
    if (!replayId) return
    const ctrl = startPipeline()
    activateProcessing()
    try {
      const plan = await reserveInteraction(overlayWin, "chat", ctrl.signal)
      const res = await fetch(`${sidecar.baseUrl}/automation/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
        body: JSON.stringify({ replayId, plan }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) throw new Error(`Sidecar replay ${res.status}`)
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
          send(overlayWin, JSON.parse(line.slice(6)) as SseEvent)
        }
      }
      endVoiceTurn()
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        send(overlayWin, {
          type: "error",
          message: err instanceof Error ? err.message : "Replay failed",
        })
        resetToIdle()
      }
    } finally {
      pipelineCtrl = null
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
      reportUsage("screenshot")
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

  // Barge-in: abort the in-flight voice turn (if any) and start listening for the
  // new request. During the TTS-drain tail the fetch is already done (pipelineCtrl
  // null), so we just transition to listening.
  ipcMain.on("yomi:barge-in", () => {
    if (pipelineCtrl) {
      bargingIn = true
      abortCurrent()
    }
    bargeInToListening()
  })

  return {
    // Voice query: STT → LLM → TTS
    onListenStop: async () => {
      const ctrl = startPipeline()
      const chunks = pcmChunks.splice(0)
      console.warn(`[yomi/voice] listen stop — captured ${chunks.length} pcm chunks`)

      // Nothing recorded — user pressed stop immediately, or capture never ran.
      // In a hands-free session this re-listens; otherwise it quietly resets.
      if (chunks.length === 0) {
        endVoiceTurn()
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
        console.warn(
          `[yomi/voice] transcript (${transcript.trim().length} chars): ${transcript.trim().slice(0, 80)}`,
        )

        // STT heard nothing — give the user a brief, dismissable hint instead of silence.
        // Re-listen if in a hands-free session (the inactivity guard stops an endless empty loop).
        if (!transcript.trim()) {
          send(overlayWin, { type: "error", message: "Didn't catch that — try again." })
          endVoiceTurn()
          return
        }

        await streamQuery(sidecar, overlayWin, transcript, capture, true, plan, ctrl)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        send(overlayWin, {
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        })
        endVoiceTurn()
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
  code?: string
  plan?: Plan
  requestsUsed?: number
  requestsLimit?: number | null
  requestsRemaining?: number | null
  resetAt?: string
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
      requestsUsed: data.requestsUsed,
      requestsLimit: data.requestsLimit,
      requestsRemaining: data.requestsRemaining,
      resetAt: data.resetAt,
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

function reportUsage(kind: string): void {
  const token = loadToken()
  if (!token) return
  fetch(`${BACKEND_URL}/api/usage/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind }),
  }).catch(() => {})
}

function buildWav(chunks: Float32Array[], sampleRate: number): Buffer {
  const MAX_SAMPLES = sampleRate * 30 // Keep voice turns bounded for cloud STT.
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
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    const message = body.error ?? `Sidecar STT ${res.status}`
    console.error(`[yomi/voice] STT HTTP ${res.status}: ${message}`)
    throw new Error(message)
  }
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

  // Imperative/desktop commands route to the agent (it has the UIA tools).
  const useAgent = !forceAnswer && (shouldUseSystemAction(text) || shouldUseAgent(text))
  const routedText = useAgent ? stripDetachedPhrase(text) : text

  // Interactive actions are hands-free: no chat transcript unless an error/confirmation needs UI.

  const endpoint = useAgent ? "/query/agent" : "/query/fast"
  const body = useAgent
    ? { text: routedText, screenshot_b64: capture.screenshot_b64, plan, history: actHistory.slice() }
    : {
        text,
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
        tts,
        plan,
      }
  const overlayWasFocusable = useAgent ? overlayWin.isFocusable() : null
  if (useAgent && overlayWasFocusable) {
    // Real-input UIA tools follow foreground focus; keep Yomi visible but unable to retake it.
    overlayWin.setFocusable(false)
    if (overlayWin.isFocused()) overlayWin.blur()
    agentAutomationFocusSuppressed = true
  }

  let sawDone = false
  let streamClosed = false
  let agentTextBuf = "" // accumulate the agent's reply to store in the Act loop history

  try {
    const res = await fetch(`${sidecar.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) {
      pipelineCtrl = null
      console.error(`[yomi/voice] ${endpoint} HTTP ${res.status}`)
      throw new Error(`Sidecar ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (value?.byteLength) {
        buf += decoder.decode(value, { stream: !done })
      }
      const lines = buf.split("\n")
      buf = lines.pop()!
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const event = JSON.parse(line.slice(6)) as SseEvent
        if (event.type === "agent_text") agentTextBuf += event.text
        if (event.type === "transcript" && transcriptLabel) event.text = transcriptLabel
        if (event.type === "act_proposed" && overlayWasFocusable && !overlayWin.isDestroyed()) {
          overlayWin.setFocusable(true)
          overlayWin.show()
          overlayWin.focus()
        }
        if (!useAgent || shouldShowInteractiveEvent(event)) {
          send(overlayWin, event)
        }
        if (event.type === "done") {
          sawDone = true
          if (useAgent) pushActTurn(text, agentTextBuf)
          endVoiceTurn()
        }
        if (event.type === "error") {
          sawDone = true
          endVoiceTurn()
        }
      }
      if (done) {
        streamClosed = true
        // Emit buffered or empty data as error so it reaches the renderer
        if (buf.trim() && buf.startsWith("data: ")) {
          try {
            const event = JSON.parse(buf.slice(6).trim()) as SseEvent
            send(overlayWin, event)
          } catch {
            /* best-effort */
          }
        }
        break
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      if (!bargingIn) resetToIdle()
      bargingIn = false
      return
    }
    // Only surface socket errors if no error event was already received
    if (!sawDone) {
      send(overlayWin, {
        type: "error",
        message: streamClosed
          ? "Voice stream closed before completion. Try again."
          : `Voice connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      })
    }
    endVoiceTurn()
    return
  } finally {
    agentAutomationFocusSuppressed = false
    if (overlayWasFocusable && !overlayWin.isDestroyed()) overlayWin.setFocusable(true)
    pipelineCtrl = null
  }

  if (!sawDone) endVoiceTurn()
}

// Append a completed agent turn to the rolling history (used for follow-up commands on a manual press).
function pushActTurn(userText: string, assistantText: string): void {
  actHistory.push({ role: "user", text: userText.trim() })
  actHistory.push({ role: "assistant", text: assistantText.trim() || "(done)" })
  if (actHistory.length > ACT_HISTORY_MAX) actHistory = actHistory.slice(-ACT_HISTORY_MAX)
}

// Strip detached-mode wording so foreground automation receives a clean task.
function stripDetachedPhrase(text: string): string {
  return (
    text
      .replace(/\b(in the background|in background|in the bg|in bg)\b/gi, "")
      .replace(/\bwithout\s+switching\b/gi, "")
      .replace(/\bwithout\s+interrupting(?:\s+me)?\b/gi, "")
      .replace(/\bwhile\s+i\s+(?:keep|am)\s+working\b/gi, "")
      .replace(/\bdon'?t\s+switch\s+away\b/gi, "")
      .replace(/\bquietly\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() || text.trim()
  )
}

// Imperative UI commands → desktop automation tasks for the agent (Spec 16).
function shouldUseAgent(text: string): boolean {
  return /\b(open|click|press|type|enter|fill|select|choose|check|uncheck|toggle|close|switch|go to|navigate|delete|send|save|copy|paste|rename|create|run|play|pause|resume|spotify|volume|sound|audio|louder|quieter|mute|unmute|increase|decrease|lower|raise|inc|dec|text|message|msg|whats\s*app|whatsapp|tell|ping)\b/i.test(
    text,
  )
}

function shouldUseSystemAction(text: string): boolean {
  return (
    /\b(volume|sound|audio|song|louder|quieter|mute|unmute|increase|decrease|lower|raise|inc|dec|spotify|whats\s*app|whatsapp)\b/i.test(
      text,
    ) ||
    /\bplay\b.+\b(song|track|music|by)\b/i.test(text) ||
    /\b(text|message|msg)\b/i.test(text)
  )
}

function shouldShowInteractiveEvent(event: SseEvent): boolean {
  return (
    event.type === "agent_text" ||
    event.type === "act_proposed" ||
    event.type === "act_result" ||
    event.type.startsWith("automation_") ||
    event.type === "error"
  )
}
