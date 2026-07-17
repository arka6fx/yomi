// Runaway-loop guards for runAgentLoop: duplicate-call and stall detection plus
// a cheap-tool step-budget refund. Concept ported (not imported) from
// agent-core keeps no desktop-only deps.
//
// Adapted to the backend loop's step-at-a-time driving: there a step with no
// tool call ends the loop, so the "steps that never call a tool" stall
// can't occur. Here a stall means consecutive windows of only bookkeeping
// (cheap) tool calls that never do meaningful work — the failure mode the
// cheap-tool refund itself creates (cheap steps don't spend the step budget).

const DUP_CALL_THRESHOLD = 3 // identical consecutive tool calls before breaking
const WINDOW_SIZE = 5 // steps per progress-gate check
const MAX_STALLED_WINDOWS = 2 // consecutive windows with no meaningful work

// Bookkeeping tools that don't count toward the step budget. Seeded from the
// CHEAP_TOOLS minus desktop-only entries (look_at_screen,
// transcribe); the backend exposes none of these today but will when memory
// tools land — the refund path is exercised via extraTools in tests.
export const CHEAP_TOOLS = new Set(["memory_write", "remember", "forget"])

export interface GuardedCall {
  toolName: string
  args: unknown
}

export type GuardKind = "duplicate" | "stall"

export interface StepDecision {
  // Set when a guard tripped and the loop should stop taking new steps.
  break: GuardKind | null
  // True when the step did meaningful (non-cheap) work and should be charged
  // against the step budget; false for bookkeeping-only steps (refunded).
  charged: boolean
}

export class LoopGuards {
  private stepsInWindow = 0
  private meaningfulInWindow = 0
  private stalledWindows = 0
  // Ring buffer of the last DUP_CALL_THRESHOLD-1 "toolName:argsJSON" keys.
  private recentCalls: string[] = []

  // Observe one completed step's tool calls (in order). Note the model already
  // executed these within the step's single generateText, so a tripped guard
  // stops the *next* step rather than pre-empting execution — enough to keep the
  // loop from thrashing indefinitely.
  observe(calls: GuardedCall[]): StepDecision {
    let hasMeaningful = false
    for (const { toolName, args } of calls) {
      if (!CHEAP_TOOLS.has(toolName)) hasMeaningful = true
      const key = `${toolName}:${JSON.stringify(args)}`
      if (
        this.recentCalls.length === DUP_CALL_THRESHOLD - 1 &&
        this.recentCalls.every((k) => k === key)
      ) {
        return { break: "duplicate", charged: hasMeaningful }
      }
      this.recentCalls.push(key)
      if (this.recentCalls.length > DUP_CALL_THRESHOLD - 1) this.recentCalls.shift()
    }

    this.stepsInWindow++
    if (hasMeaningful) this.meaningfulInWindow++

    if (this.stepsInWindow >= WINDOW_SIZE) {
      if (this.meaningfulInWindow === 0) this.stalledWindows++
      else this.stalledWindows = 0
      this.stepsInWindow = 0
      this.meaningfulInWindow = 0
      if (this.stalledWindows >= MAX_STALLED_WINDOWS) {
        return { break: "stall", charged: hasMeaningful }
      }
    }

    return { break: null, charged: hasMeaningful }
  }
}
