export { EnergyVad, detectSpeechEnd } from "./vad.js"
export type { VadResult, VadOptions } from "./vad.js"
export {
  costMicros,
  resolveModelPrice,
  microsToCents,
  microsToUsd,
  type ModelPrice,
  type TokenCounts,
} from "./ai-pricing.js"
export {
  CONSENT_VERSION,
  PRIVACY_CONSENT_PURPOSE_LABELS,
  PRIVACY_CONSENT_PURPOSES,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  isPrivacyConsentPurpose,
} from "./privacy.js"
export type { PrivacyConsentPurpose, PrivacyConsentStatus } from "./privacy.js"

export type UserRole = "user" | "owner"
export type Plan = "explore" | "pro" | "max"
export type SubscriptionStatus = "inactive" | "active" | "past_due"

export const DEFAULT_AGENT_SOUL = `\
You are Yomi: sharp, warm, and practical.
Speak plainly. Prefer the shortest complete answer over a polished essay.
Be useful before being clever. If the user is stuck, reduce the problem to the next concrete step.
Ask at most one clarifying question when it changes the outcome; otherwise make a reasonable assumption and move.
Do not fake access, results, files, memories, or connector data. Say what you know, what you checked, and what remains uncertain.
Keep boundaries firm: no unsafe help, no hidden actions, no pretending to control apps or accounts without an explicit available tool.`

export function formatAgentSoul(soul: string | undefined): string {
  const text = soul?.trim() || DEFAULT_AGENT_SOUL
  return text ? `<agent_soul>\n${text}\n</agent_soul>` : ""
}

// Replace em (U+2014) and en (U+2013) dashes — along with any spaces hugging them —
// with a comma and a space, so Yomi's replies read like natural human writing instead
// of looking AI-generated. Only U+2014/U+2013 are touched: hyphen-minus "-" (markdown
// bullets, "->", code) is left alone. Idempotent — the output contains no em/en dashes,
// so it is safe to re-run on a growing stream buffer.
export function humanizeDashes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ", ")
}

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

export type IntentPath = "fast" | "agent"

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
  skipReserve?: boolean // when true, the pipeline skips its own reserveInteraction("chat") call
  conversationId?: string // scopes conversation state; defaults to "desktop"
}

export interface AgentQueryRequest {
  text: string
  screenshot_b64?: string
  task?: string
  tts?: boolean // true = voice output; false = text only (default: true)
  plan?: Plan // controls local-only memory injection/writes
  history?: { role: "user" | "assistant"; text: string }[] // prior turns for the conversational act loop
  skipReserve?: boolean // when true, the pipeline skips its own reserveInteraction("chat") call
  conversationId?: string // scopes conversation state; defaults to "desktop"
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
  // Agent-path events
  | { type: "agent_text"; text: string }
  | { type: "agent_tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "agent_tool_result"; tool: string; result: unknown }
  | { type: "agent_step"; iteration: number; max: number }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "usage_limit"; code: string; feature: string; message: string; upgradeUrl?: string }
  | { type: "rate_limit"; message: string; seconds: number }
  // Gateway events (Spec 19 — Messaging Gateway)
  | { type: "gateway_connected"; platform: PlatformType }
  | { type: "gateway_disconnected"; platform: PlatformType }
  | { type: "gateway_error"; platform: PlatformType; message: string }
  | {
      type: "gateway_message"
      platform: PlatformType
      chatId: string
      userId: string
      text: string
    }
  | { type: "gateway_session"; platform: PlatformType; chatId: string; active: boolean }

export type PlatformType = "telegram"

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
  /** Resolved Yomi user ID — set by the backend gateway before forwarding to the sidecar */
  yomiUserId?: string
  text: string
  messageId?: string
  timestamp: string
  /** URL of an audio file (voice note) to transcribe before processing */
  audioUrl?: string
  /** MIME type of the audio file, defaults to audio/ogg */
  audioMimeType?: string
  /** Audio duration in seconds when supplied by the platform */
  audioDurationSeconds?: number
  /** URL of an image file to analyze before processing */
  imageUrl?: string
  /** MIME type of the image file, defaults to image/jpeg */
  imageMimeType?: string
  /** URL of a document file (PDF, DOCX, XLSX, PPTX, etc.) to parse before processing */
  documentUrl?: string
  /** MIME type of the document file */
  documentMimeType?: string
  /** Original filename of the document */
  documentFileName?: string
  /** File size in bytes */
  documentSize?: number
  /** URL of a video file to process */
  videoUrl?: string
  /** MIME type of the video file */
  videoMimeType?: string
  /** Video duration in seconds when supplied by the platform */
  videoDurationSeconds?: number
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
