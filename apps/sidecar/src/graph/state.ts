import type { CoreMessage } from "ai"
import type { AutomationState, Plan } from "@yomi/shared"
import type { ErrorClass } from "./error-classifier.js"

// Graph state for the agent-path orchestrator. Mirrors the spec's required fields.
// Non-serializable per-request deps (emit, signal, tools, guards) live on GraphDeps, NOT here,
// so a phase-2 checkpointer upgrade stays drop-in.

export type ExecutionMode = "foreground" | "approval"
export type ValidationStatus = "pending" | "passed" | "failed"
export type PermissionStatus = "none" | "pending" | "granted" | "denied"

export interface ToolHistoryItem {
  tool: string
  failed: boolean
}

export interface GraphState {
  taskId: string
  goal: string
  plan: Plan | undefined
  systemPrompt: string
  messages: CoreMessage[]
  steps: string[]
  executionMode: ExecutionMode
  currentStep: string
  agentId: string
  providerId: string
  agentStatus: AutomationState
  validationStatus: ValidationStatus
  permissionStatus: PermissionStatus
  recoveryCount: number
  lastError: string | null
  errorClass: ErrorClass
  recoveryError: string
  recoveryStrategy: string
  toolHistory: ToolHistoryItem[]
  memoryRefs: string[]
  stepCount: number
  summaryText: string
  failed: boolean
  finalSummary: string
}

export type GraphInput = Partial<GraphState> & Pick<GraphState, "goal">

export function createInitialState(input: GraphInput): GraphState {
  return {
    taskId: input.taskId ?? "",
    goal: input.goal,
    plan: input.plan,
    systemPrompt: input.systemPrompt ?? "",
    messages: input.messages ?? [],
    steps: input.steps ?? [],
    executionMode: input.executionMode ?? "foreground",
    currentStep: input.currentStep ?? "",
    agentId: input.agentId ?? "automation",
    providerId: input.providerId ?? "native",
    agentStatus: input.agentStatus ?? "thinking",
    validationStatus: input.validationStatus ?? "pending",
    permissionStatus: input.permissionStatus ?? "none",
    recoveryCount: input.recoveryCount ?? 0,
    lastError: input.lastError ?? null,
    errorClass: input.errorClass ?? "unknown",
    recoveryError: input.recoveryError ?? "",
    recoveryStrategy: input.recoveryStrategy ?? "",
    toolHistory: input.toolHistory ?? [],
    memoryRefs: input.memoryRefs ?? [],
    stepCount: input.stepCount ?? 0,
    summaryText: input.summaryText ?? "",
    failed: input.failed ?? false,
    finalSummary: input.finalSummary ?? "",
  }
}

export function mergeGraphState(state: GraphState, patch: Partial<GraphState>): GraphState {
  return {
    ...state,
    ...patch,
    messages: patch.messages ? state.messages.concat(patch.messages) : state.messages,
    toolHistory: patch.toolHistory ? state.toolHistory.concat(patch.toolHistory) : state.toolHistory,
    memoryRefs: patch.memoryRefs ? state.memoryRefs.concat(patch.memoryRefs) : state.memoryRefs,
  }
}
