import type { LanguageModelV1, ToolSet } from "ai"
import type { AgentQueryRequest, Plan, SseEvent } from "@yomi/shared"
import type { Hooks } from "../harness/hooks.js"
import type { LoopGuards } from "../harness/guards.js"
import type { AutomationSession } from "../automation/runs.js"
import type { UiaPort } from "../automation/providers/types.js"
import type { writeSessionTurn } from "../memory/subsystem.js"
import type { EventBridge } from "./events.js"

export type WriteSessionTurn = typeof writeSessionTurn

// Per-request, non-serializable dependencies threaded to every node factory.
// Kept off GraphState so the graph stays checkpointable in a later phase.
export interface GraphDeps {
  req: AgentQueryRequest
  emit: (e: SseEvent) => void
  signal?: AbortSignal
  hooks: Hooks
  guards: LoopGuards
  automation: AutomationSession
  bridge: EventBridge
  // Model factory for the execution burst (injectable for tests; defaults to createModel).
  modelFactory: (id: string) => LanguageModelV1
  toolsPromise: Promise<ToolSet>
  // UIA port for provider/agent validation (injectable for tests; defaults to the uia singleton).
  uia: UiaPort
  writeTurn: WriteSessionTurn
  // Coarse human-approval gate (injectable for tests). Resolves true=approved.
  requestApproval: (label: string, reason: string) => Promise<boolean>
  // Set when the Completion node has emitted a terminal automation event, so run.ts's
  // finally-block doesn't double-close the run.
  markClosed: () => void
}

// was: process.env["AGENT_PATH_MODEL"] || "gpt-4.1"
export const AGENT_PATH_MODEL = process.env["AGENT_PATH_MODEL"] || "minimax.minimax-m2.5"
// Steps per execution burst. Defaults to the legacy 20 so single-burst reach matches the old
// loop; Validation/Recovery wrap the burst rather than shrinking it. Tune down via env.
export const BURST_STEPS = parseInt(process.env["AGENT_MAX_STEPS"] || "20", 10)
export const MAX_RECOVERIES = parseInt(process.env["AGENT_MAX_RECOVERIES"] || "2", 10)

// Coarse graph-level approval gate. Off by default to avoid double-prompting alongside the
// per-tool act-bus confirmations (e.g. send_whatsapp_message confirms its own send).
// Read at call time so it can be toggled per-run / in tests.
export function graphApprovalGate(): boolean {
  return process.env["YOMI_GRAPH_APPROVAL_GATE"] === "1"
}

export function memoryEnabled(plan: Plan | undefined): boolean {
  return plan === "pro" || plan === "max"
}
