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
} from "./hotkey"
import { BACKEND_URL, loadToken } from "./auth"

// The mic only ever opens on the Voice button / Ctrl+Space — nothing here re-arms listening.
let conversationHistory: { role: "user" | "assistant"; text: string }[] = []
const CONVERSATION_HISTORY_MAX = 16 // last 8 turns (user + assistant each)

type Plan = "explore" | "pro" | "max"

// Screen-analysis prompt for the Analyze button / Ctrl+S. The chat shows SCREEN_LABEL instead.
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
let ttsPreference = true

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
  pcmChunks = []
  conversationHistory = []
}

async function cloudConversationHeaders(): Promise<Record<string, string> | null> {
  const token = await loadToken()
  if (!token) return null
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
}

async function refreshCloudConversationHistory(signal?: AbortSignal): Promise<void> {
  const headers = await cloudConversationHeaders()
  if (!headers) return
  const res = await fetch(`${BACKEND_URL}/api/conversation/shared`, { headers, signal })
  if (!res.ok) return
  const data = await res.json() as { history?: Array<{ role: "user" | "assistant" | "system"; content: string }> }
  const history = (data.history ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", text: m.content }))
  conversationHistory = history.slice(-CONVERSATION_HISTORY_MAX)
}

async function appendCloudConversationTurn(userText: string, assistantText: string): Promise<void> {
  const headers = await cloudConversationHeaders()
  if (!headers) return
  await fetch(`${BACKEND_URL}/api/conversation/shared/turn`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userText, assistantText }),
  }).catch(() => {})
}

async function resetCloudConversation(): Promise<void> {
  const headers = await cloudConversationHeaders()
  if (!headers) return
  await fetch(`${BACKEND_URL}/api/conversation/shared/reset`, { method: "POST", headers }).catch(() => {})
}

// Registers sidecar-dependent IPC handlers. Called once after first auth.
export function initSidecarIpc(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
): {
  onListenStop: () => Promise<void>
  onTextQuery: () => void
  onAbort: () => void
  onAnalyze: () => Promise<void>
} {
  ipcMain.on("yomi:audio-chunk", (_e, pcm: ArrayBuffer, sampleRate: number) => {
    pcmChunks.push(new Float32Array(pcm))
    capturedSampleRate = sampleRate
  })

  ipcMain.on("yomi:set-tts", (_e, enabled: boolean) => {
    ttsPreference = enabled
  })

  // Text query: text-only output (no TTS)
  ipcMain.on("yomi:text-query", async (_e, text: string, attachmentB64?: string | null) => {
    const trimmed = text?.trim()
    if (!trimmed) {
      resetToIdle()
      return
    }
    if (trimmed === "/new") {
      conversationHistory = []
      await resetCloudConversation()
      send(overlayWin, { type: "llm_chunk", text: "Started a new conversation. How can I help you?" })
      send(overlayWin, { type: "done" })
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
      await refreshCloudConversationHistory(ctrl.signal).catch(() => {})
      const capture = await captureScreen()
      if (ctrl.signal.aborted) {
        resetToIdle()
        return
      }
      // When the user attached a file, inject it as the primary screenshot so the
      // LLM sees the attached image rather than (or in addition to) the screen.
      const effectiveCapture = attachmentB64
        ? { ...capture, screenshot_b64: attachmentB64 }
        : capture
      await streamQuery(sidecar, overlayWin, trimmed, effectiveCapture, false, plan, ctrl)
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
  // Shared by the Analyze toolbar button and its global hotkey.
  const runAnalyze = async (): Promise<void> => {
    if (getHotkeyState() !== "idle") return
    const ctrl = startPipeline()
    activateProcessing()
    try {
      const plan = await reserveInteraction(overlayWin, "analyze", ctrl.signal)
      if (ctrl.signal.aborted) {
        resetToIdle()
        return
      }
      await refreshCloudConversationHistory(ctrl.signal).catch(() => {})
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
  ipcMain.on("yomi:trigger-analyze", () => {
    void runAnalyze()
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
        await refreshCloudConversationHistory(ctrl.signal).catch(() => {})
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

        await streamQuery(sidecar, overlayWin, transcript, capture, ttsPreference, plan, ctrl)
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
    onAnalyze: runAnalyze,
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

type ReserveKind = "chat" | "voice" | "analyze"

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
    console.error(`[yomi/reserve] failed: ${res.status} ${JSON.stringify(data)}`)
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
  transcriptLabel?: string, // shown in chat instead of `text` (e.g. for the Analyze button)
  forceAnswer = false, // skip all intent routing — always the fast screen-answer path
): Promise<void> {
  pipelineCtrl = ctrl // keep reference current (startPipeline may have rotated it)

  const endpoint = forceAnswer ? "/query/fast" : "/query"
  const body = {
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
    history: conversationHistory.slice(),
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
      const errorText = await res.text()
      console.error(`[yomi/streamQuery] ${endpoint} HTTP ${res.status}: ${errorText}`)
      throw new Error(`Sidecar ${res.status}: ${errorText}`)
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
        if (event.type === "llm_chunk") agentTextBuf += event.text
        if (event.type === "transcript" && transcriptLabel) event.text = transcriptLabel
        if (shouldShowInteractiveEvent(event)) send(overlayWin, event)
        if (event.type === "done") {
          sawDone = true
          pushConversationTurn(transcriptLabel ?? text, agentTextBuf || "")
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
      resetToIdle()
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
    pipelineCtrl = null
  }

  if (!sawDone) endVoiceTurn()
}

function pushConversationTurn(userText: string, assistantText: string): void {
  conversationHistory.push({ role: "user", text: userText.trim() })
  conversationHistory.push({ role: "assistant", text: assistantText.trim() || "(done)" })
  if (conversationHistory.length > CONVERSATION_HISTORY_MAX) {
    conversationHistory = conversationHistory.slice(-CONVERSATION_HISTORY_MAX)
  }
  void appendCloudConversationTurn(userText, assistantText || "(done)")
}

function shouldShowInteractiveEvent(event: SseEvent): boolean {
  return (
    event.type === "agent_text" ||
    event.type === "llm_chunk" ||
    event.type === "transcript" ||
    event.type === "audio_chunk" ||
    event.type === "usage_limit" ||
    event.type === "error"
  )
}
