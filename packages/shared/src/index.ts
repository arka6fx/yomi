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
  history?: { role: "user" | "assistant"; text: string }[]
}

export interface AgentQueryRequest {
  text: string
  screenshot_b64?: string
  task?: string
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
