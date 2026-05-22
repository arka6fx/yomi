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

export interface FastQueryRequest {
  text?: string
  audio_b64?: string       // base64-encoded WAV; sidecar runs STT before LLM
  screenshot_b64?: string
  mode?: "answer" | "guide"
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
  | { type: "done" }
  | { type: "error"; message: string }
