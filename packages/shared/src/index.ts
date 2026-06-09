export { EnergyVad, detectSpeechEnd } from "./vad.js"
export type { VadResult, VadOptions } from "./vad.js"

export type UserRole = "user" | "owner"
export type Plan = "explore" | "pro" | "max"
export type SubscriptionStatus = "inactive" | "active" | "past_due"

export interface ChunkOptions {
  targetChars?: number
  overlap?: number
}

// Structure-aware chunking shared by cloud (backend) and local (sidecar) RAG indexers.
// Splits on markdown blank-line / heading boundaries, then greedily packs segments into
// ~targetChars windows with a small carried overlap. An oversized paragraph is hard-split
// so no chunk blows the window. Returns trimmed, non-empty chunks.
export function chunkMarkdown(content: string, opts: ChunkOptions = {}): string[] {
  const targetChars = Math.max(16, opts.targetChars ?? 1800)
  const overlap = Math.max(0, Math.min(opts.overlap ?? 220, Math.floor(targetChars / 2)))
  const text = content.replace(/\r/g, "").trim()
  if (!text) return []

  // Paragraph/heading segments (blank-line separated). Hard-split any oversized segment.
  const segments: string[] = []
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim()
    if (!trimmed) continue
    if (trimmed.length <= targetChars) {
      segments.push(trimmed)
      continue
    }
    let start = 0
    while (start < trimmed.length) {
      const end = Math.min(trimmed.length, start + targetChars)
      const piece = trimmed.slice(start, end).trim()
      if (piece) segments.push(piece)
      if (end === trimmed.length) break
      start = Math.max(0, end - overlap)
    }
  }

  // Greedily pack segments; carry a tail overlap from the previous chunk for continuity.
  const chunks: string[] = []
  let current = ""
  for (const seg of segments) {
    if (!current) {
      current = seg
      continue
    }
    if (current.length + 2 + seg.length <= targetChars) {
      current += `\n\n${seg}`
    } else {
      chunks.push(current)
      const tail = overlap > 0 ? current.slice(-overlap).trim() : ""
      current = tail ? `${tail}\n\n${seg}` : seg
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

export interface ScreenImage {
  screen: number
  screenshot_b64: string
  width: number
  height: number
  is_cursor_screen?: boolean
}

// UIA app automation (Spec 16) — shapes the uia-helper emits and the sidecar/desktop consume.
export interface UiaElement {
  ref: string // stable within the latest snapshot only: "w<window>e<element>"
  role: string // control type: "Button", "Edit", "MenuItem", ...
  name: string
  automationId?: string
  rect: { x: number; y: number; width: number; height: number } // physical screen px
  patterns: string[] // ["Invoke","Value","Toggle","ExpandCollapse","SelectionItem","Scroll","ScrollItem","LegacyIAccessible"]
  enabled: boolean
  offscreen?: boolean // rect is empty or outside the window — needs ScrollIntoView/vision
  value?: string | null
  rangeValue?: number | null // RangeValuePattern current (e.g. Spotify volume slider 0..100)
}

export interface UiaSnapshot {
  window: string
  elements: UiaElement[]
}

export type UiaAction =
  | { kind: "invoke"; ref: string }
  | { kind: "set_value"; ref: string; text: string }
  | { kind: "toggle"; ref: string }
  | { kind: "click_point"; x: number; y: number; button?: "left" | "right" | "middle" }

export type IntentPath = "fast" | "agent"

export type AutomationState =
  | "idle"
  | "thinking"
  | "executing"
  | "waiting"
  | "needs_approval"
  | "completed"
  | "failed"
  | "recovering"

export type AutomationRisk = "safe" | "moderate" | "dangerous"

export interface AutomationOwner {
  id: string
  label: string
}

export interface AutomationPreview {
  steps: string[]
  estimatedSeconds: number
  risk: AutomationRisk
  confidence: number
}

export interface AutomationTimelineItem {
  id: string
  at: string
  label: string
  status: "planned" | "running" | "waiting" | "done" | "failed" | "skipped"
  detail?: string
}

export interface AutomationRun {
  id: string
  owner: AutomationOwner
  task: string
  state: AutomationState
  startedAt: string
  endedAt?: string
  currentStep?: string
  nextStep?: string
  step?: number
  maxSteps?: number
  estimatedSeconds?: number
  confidence?: number
  replayId?: string
  timeline: AutomationTimelineItem[]
}

export interface AutomationReplay {
  id: string
  runId: string
  task: string
  owner: AutomationOwner
  createdAt: string
}

export interface IntentClassification {
  path: IntentPath
  confidence: number // 0..1
  reason: string
  source: "heuristic" | "llm"
}

export interface RouterInput {
  text: string
  screenshot_b64?: string
  history?: { role: "user" | "assistant"; text: string }[] // last 2 turns max
}

export interface FastQueryRequest {
  text?: string
  audio_b64?: string // base64-encoded WAV; sidecar runs STT before LLM
  screenshot_b64?: string
  screenshots?: ScreenImage[]
  tts?: boolean // true = voice output; false = text only (default: true)
  plan?: Plan // controls local-only memory injection/writes
  history?: { role: "user" | "assistant"; text: string }[]
}

export interface AgentQueryRequest {
  text: string
  screenshot_b64?: string
  task?: string
  plan?: Plan // controls local-only memory injection/writes
  history?: { role: "user" | "assistant"; text: string }[] // prior turns for the conversational act loop
}

export interface CloudRagSnippet {
  chunkId: string
  documentId: string
  sourceId: string
  sourceName: string
  title: string
  content: string
  score: number
  marker: number // 1-based citation index for inline [n] references
}

export interface CloudArchiveSource {
  path: string
  title: string
  content: string
  contentHash: string
  updatedAt: string
}

export interface CloudRagSyncRequest {
  sources: CloudArchiveSource[]
  removedPaths?: string[]
}

export interface RagSourceInfo {
  id: string
  name: string
  path?: string | null
  contentHash?: string | null
  sourceType: string
  status: string
  documentCount: number
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export type SseEvent =
  | { type: "transcript"; text: string }
  | { type: "llm_chunk"; text: string }
  | { type: "audio_chunk"; base64: string }
  | { type: "tts_error"; message: string }
  | {
      type: "router_decision"
      path: IntentPath
      confidence: number
      reason: string
      source: "heuristic" | "llm"
    }
  // Act loop (Spec 16) — propose an action (risky ones await voice confirm), then report the result.
  // `rect` (physical screen px) lets the desktop highlight the target before acting.
  | {
      type: "act_proposed"
      id: string
      action: UiaAction
      label: string
      risky: boolean
      rect?: { x: number; y: number; width: number; height: number }
    }
  | { type: "act_result"; ok: boolean; label: string; detail?: string }
  // Agent-path events
  | { type: "agent_text"; text: string }
  | { type: "agent_tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "agent_tool_result"; tool: string; result: unknown }
  | { type: "agent_step"; iteration: number; max: number }
  // Automation Mission Control (Spec 18)
  | { type: "automation_started"; run: AutomationRun }
  | { type: "automation_preview"; runId: string; preview: AutomationPreview }
  | {
      type: "automation_step"
      runId: string
      state: AutomationState
      currentStep: string
      nextStep?: string
      step?: number
      maxSteps?: number
      estimatedSeconds?: number
      confidence?: number
    }
  | { type: "automation_timeline"; runId: string; item: AutomationTimelineItem }
  | { type: "automation_waiting"; runId: string; reason: string; risk: AutomationRisk }
  | { type: "automation_completed"; runId: string; summary: string; replayId?: string }
  | { type: "automation_failed"; runId: string; error: string; replayId?: string }
  | { type: "automation_recovering"; runId: string; reason: string }
  | { type: "done" }
  | { type: "error"; message: string }
  // Gateway events (Spec 19 — Messaging Gateway)
  | { type: "gateway_connected"; platform: PlatformType }
  | { type: "gateway_disconnected"; platform: PlatformType }
  | { type: "gateway_error"; platform: PlatformType; message: string }
  | { type: "gateway_message"; platform: PlatformType; chatId: string; userId: string; text: string }
  | { type: "gateway_session"; platform: PlatformType; chatId: string; active: boolean }

export type PlatformType = "telegram" | "discord" | "slack"

export interface PlatformConfig {
  type: PlatformType
  token: string
  additionalToken?: string
  enabled: boolean
}

export interface GatewayMessage {
  platform: PlatformType
  chatId: string
  userId: string
  text: string
  messageId?: string
  timestamp: string
}

export interface GatewaySessionInfo {
  id: string
  platform: PlatformType
  chatId: string
  userId: string
  createdAt: string
  lastActivityAt: string
  messageCount: number
}

export interface PlatformConnection {
  platform: PlatformType
  platformUserId: string
  platformChatId?: string
  connectedAt: string
}
