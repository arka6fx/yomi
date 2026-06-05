import { Annotation } from "@langchain/langgraph"
import type { CoreMessage } from "ai"
import type { AutomationState, Plan } from "@yomi/shared"

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

// append-and-flatten reducer for list channels
function appendList<T>() {
  return {
    reducer: (acc: T[], v: T[] | T): T[] => acc.concat(Array.isArray(v) ? v : [v]),
    default: (): T[] => [],
  }
}

export const GraphAnnotation = Annotation.Root({
  // Identity / inputs
  taskId: Annotation<string>(), // = automation run id
  goal: Annotation<string>(),
  plan: Annotation<Plan | undefined>({ reducer: (_, v) => v, default: () => undefined }),

  // Conversation carried across execution bursts
  systemPrompt: Annotation<string>({ reducer: (_, v) => v, default: () => "" }),
  messages: Annotation<CoreMessage[]>(appendList<CoreMessage>()),

  // Plan / control
  steps: Annotation<string[]>({ reducer: (_, v) => v, default: () => [] }),
  executionMode: Annotation<ExecutionMode>({ reducer: (_, v) => v, default: () => "foreground" }),
  currentStep: Annotation<string>({ reducer: (_, v) => v, default: () => "" }),

  // Routing: which sub-agent + provider handles this turn (set by Planning, read by Execution/Validation)
  agentId: Annotation<string>({ reducer: (_, v) => v, default: () => "automation" }),
  providerId: Annotation<string>({ reducer: (_, v) => v, default: () => "native" }),

  // Status
  agentStatus: Annotation<AutomationState>({ reducer: (_, v) => v, default: () => "thinking" }),
  validationStatus: Annotation<ValidationStatus>({
    reducer: (_, v) => v,
    default: () => "pending",
  }),
  permissionStatus: Annotation<PermissionStatus>({ reducer: (_, v) => v, default: () => "none" }),

  // Recovery
  recoveryCount: Annotation<number>({ reducer: (_, v) => v, default: () => 0 }),
  lastError: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  // The error the last recovery addressed + the corrective strategy it applied. Completion records
  // these as a learned recovery when the subsequent attempt validates.
  recoveryError: Annotation<string>({ reducer: (_, v) => v, default: () => "" }),
  recoveryStrategy: Annotation<string>({ reducer: (_, v) => v, default: () => "" }),

  // Bookkeeping
  toolHistory: Annotation<ToolHistoryItem[]>(appendList<ToolHistoryItem>()),
  memoryRefs: Annotation<string[]>(appendList<string>()),
  stepCount: Annotation<number>({ reducer: (_, v) => v, default: () => 0 }),
  summaryText: Annotation<string>({ reducer: (_, v) => v, default: () => "" }),

  // Outcome
  failed: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),
  finalSummary: Annotation<string>({ reducer: (_, v) => v, default: () => "" }),
})

export type GraphState = typeof GraphAnnotation.State
