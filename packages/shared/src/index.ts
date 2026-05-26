export type UserRole = "user" | "owner"
export type Plan = "explore" | "pro" | "max"
export type SubscriptionStatus = "inactive" | "active" | "past_due"

export interface GuideElement {
  label: string
  bbox: { x: number; y: number; width: number; height: number }
}

export interface GuideStep {
  instruction: string
  elements: GuideElement[]
}

export interface GuideResponse {
  steps: GuideStep[]
}

export type IntentPath = "fast" | "agent"

export interface IntentClassification {
  path: IntentPath
  confidence: number   // 0..1
  reason: string
  source: "heuristic" | "llm"
}

export interface RouterInput {
  text: string
  screenshot_b64?: string
  history?: { role: "user" | "assistant"; text: string }[]  // last 2 turns max
}

export interface FastQueryRequest {
  text?: string
  audio_b64?: string       // base64-encoded WAV; sidecar runs STT before LLM
  screenshot_b64?: string
  mode?: "answer" | "guide"
  tts?: boolean            // true = voice output; false = text only (default: true)
  plan?: Plan              // controls local-only memory injection/writes
  history?: { role: "user" | "assistant"; text: string }[]
  cloud_rag_enabled?: boolean
  auth_token?: string       // bearer token used by sidecar for opt-in cloud RAG search
}

export interface AgentQueryRequest {
  text: string
  screenshot_b64?: string
  task?: string
  plan?: Plan              // controls local-only memory injection/writes
  cloud_rag_enabled?: boolean
  auth_token?: string
}

export interface CloudRagSnippet {
  chunkId: string
  documentId: string
  sourceId: string
  title: string
  content: string
  score: number
}

export interface RagSourceInfo {
  id: string
  name: string
  sourceType: string
  status: string
  documentCount: number
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface RagUploadFile {
  path: string
  name: string
  sizeBytes: number
}

export interface RagIndexResult {
  path: string
  name: string
  ok: boolean
  sourceId?: string
  chunks?: number
  error?: string
}

export type SseEvent =
  | { type: "transcript"; text: string }
  | { type: "llm_chunk"; text: string }
  | { type: "audio_chunk"; base64: string }
  | { type: "visual_guide"; step: number; total_steps: number; instruction: string; elements: GuideElement[] }
  | { type: "router_decision"; path: IntentPath; confidence: number; reason: string; source: "heuristic" | "llm" }
  // Agent-path events
  | { type: "agent_text"; text: string }
  | { type: "agent_tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "agent_tool_result"; tool: string; result: unknown }
  | { type: "agent_step"; iteration: number; max: number }
  | { type: "done" }
  | { type: "error"; message: string }
