// Anti-hallucination / runaway-loop guards consumed by agentPipeline.
// Tool-output trim is delegated to hooks.onPostToolUse — not duplicated here.

export type GuardResult = { break: false } | { break: true; reason: string }

const WINDOW_SIZE = 5          // steps per progress-gate check
const MAX_STALLED_WINDOWS = 2  // consecutive empty windows before break
const DUP_CALL_THRESHOLD = 3   // identical consecutive tool calls before break

export class LoopGuards {
  private stepCount = 0
  private toolCallsInWindow = 0
  private stalledWindows = 0
  // Ring buffer of the last DUP_CALL_THRESHOLD "toolName:argsJSON" strings.
  private recentCalls: string[] = []

  // Call on every step-finish event.
  onStep(): GuardResult {
    this.stepCount++

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

    const key = `${toolName}:${JSON.stringify(args)}`
    this.recentCalls.push(key)
    if (this.recentCalls.length > DUP_CALL_THRESHOLD) {
      this.recentCalls.shift()
    }

    if (
      this.recentCalls.length === DUP_CALL_THRESHOLD &&
      this.recentCalls.every(k => k === key)
    ) {
      return {
        break: true,
        reason: `duplicate: ${toolName} called ${DUP_CALL_THRESHOLD}× with identical args`,
      }
    }

    return { break: false }
  }
}
