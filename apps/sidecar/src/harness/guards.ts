// Anti-hallucination / runaway-loop guards consumed by agentPipeline.
// Tool-output trim is delegated to hooks.onPostToolUse — not duplicated here.
// Tool-call failure loops (exact-failure, same-tool, no-progress) are detected by
// the per-turn ToolCallGuardrailController in hooks.ts; this module reads its
// halt decision on every step and breaks the burst when the controller trips.
// Context-compression threshold check lives in the agent/compressor module;
// this file re-exports shouldCompress for ergonomic imports at the call sites.

import { toolGuardrail } from "./hooks.js"
import type { ToolGuardrailDecision } from "../tools/guardrails/index.js"
import { shouldCompress as shouldCompressContext } from "../agent/index.js"

export type GuardResult = { break: false } | { break: true; reason: string }

const WINDOW_SIZE = 5 // steps per progress-gate check
const MAX_STALLED_WINDOWS = 2 // consecutive empty windows before break
const DUP_CALL_THRESHOLD = 3 // identical consecutive tool calls before break

// Bookkeeping-only tools that don't consume the agent's step budget.
// A step whose every tool call is in this set is refunded (stepCount not incremented).
const CHEAP_TOOLS = new Set(["memory_write", "remember", "forget", "look_at_screen", "transcribe"])

// Plan-based context-compression threshold. Callers feed in the current
// messages + model context window; the function returns true when the
// conversation is over the plan's threshold and should be compressed before
// the next streamText burst. Mirrors the per-plan table in agent/compressor.ts.
export { shouldCompressContext as shouldCompress }

export class LoopGuards {
  private stepCount = 0
  private toolCallsInWindow = 0
  private stalledWindows = 0
  // Ring buffer of the last DUP_CALL_THRESHOLD "toolName:argsJSON" strings.
  private recentCalls: string[] = []
  // True when at least one non-cheap tool was called in the current step.
  private hasNonCheapCallInStep = false
  // Source of the per-turn guardrail halt decision. Injected for tests; defaults
  // to the module-level singleton shared with hooks.onPreToolUse / onPostToolUse.
  private readonly guardrailSource: { haltDecision: ToolGuardrailDecision | null }

  constructor(guardrailSource?: { haltDecision: ToolGuardrailDecision | null }) {
    this.guardrailSource = guardrailSource ?? toolGuardrail
  }

  // Call on every step-finish event.
  onStep(): GuardResult {
    // Only charge the step budget for steps that did meaningful work.
    // Bookkeeping-only steps (memory writes, reads, look_at_screen) are refunded.
    if (this.hasNonCheapCallInStep) {
      this.stepCount++
    }
    this.hasNonCheapCallInStep = false

    // Guardrail halt is the highest-priority break — exact-failure or same-tool
    // failure loop reached the hard-stop threshold this turn.
    const halt = this.guardrailSource.haltDecision
    if (halt) {
      return { break: true, reason: `guardrail_halt: ${halt.code} — ${halt.message}` }
    }

    if (this.stepCount % WINDOW_SIZE === 0) {
      if (this.toolCallsInWindow === 0) {
        this.stalledWindows++
      } else {
        this.stalledWindows = 0
      }
      this.toolCallsInWindow = 0

      if (this.stalledWindows >= MAX_STALLED_WINDOWS) {
        return {
          break: true,
          reason: `no tool calls in last ${WINDOW_SIZE * MAX_STALLED_WINDOWS} steps — possible stall`,
        }
      }
    }

    return { break: false }
  }

  // Call on every tool-call event (before execution).
  onToolCall(toolName: string, args: unknown): GuardResult {
    this.toolCallsInWindow++
    if (!CHEAP_TOOLS.has(toolName)) this.hasNonCheapCallInStep = true
    const key = `${toolName}:${JSON.stringify(args)}`
    if (
      this.recentCalls.length === DUP_CALL_THRESHOLD - 1 &&
      this.recentCalls.every((k) => k === key)
    ) {
      return {
        break: true,
        reason: `duplicate: ${toolName} called ${DUP_CALL_THRESHOLD}× with identical args`,
      }
    }

    this.recentCalls.push(key)
    if (this.recentCalls.length > DUP_CALL_THRESHOLD - 1) {
      this.recentCalls.shift()
    }

    return { break: false }
  }
}
