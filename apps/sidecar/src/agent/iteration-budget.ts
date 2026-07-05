// Cost-aware iteration budget for agent loops.
// Tracks both step count and output token usage.
// When either budget is exhausted, the agent should switch to a
// tool-less summary call instead of hard-stopping.

export interface IterationBudgetConfig {
  maxSteps: number
  maxOutputTokens: number
}

export const DEFAULT_ITERATION_BUDGET: IterationBudgetConfig = {
  maxSteps: parseInt(process.env["AGENT_MAX_STEPS"] || "25", 10),
  maxOutputTokens: parseInt(process.env["AGENT_MAX_OUTPUT_TOKENS"] || "16384", 10),
}

export class IterationBudget {
  private readonly maxSteps: number
  private readonly maxOutputTokens: number
  private usedSteps = 0
  private usedOutputTokens = 0

  constructor(config?: Partial<IterationBudgetConfig>) {
    const resolved = { ...DEFAULT_ITERATION_BUDGET, ...config }
    this.maxSteps = resolved.maxSteps
    this.maxOutputTokens = resolved.maxOutputTokens
  }

  /** Reserve budget for one step. Returns false if any budget is exhausted. */
  consume(stepOutputTokens = 0): boolean {
    if (this.usedSteps >= this.maxSteps) return false
    if (this.usedOutputTokens + stepOutputTokens > this.maxOutputTokens) return false
    this.usedSteps++
    this.usedOutputTokens += stepOutputTokens
    return true
  }

  /** Refund the last step (used for cheap/bookkeeping-only tools). */
  refund(): void {
    if (this.usedSteps > 0) this.usedSteps--
  }

  get remainingSteps(): number {
    return Math.max(0, this.maxSteps - this.usedSteps)
  }

  get remainingOutputTokens(): number {
    return Math.max(0, this.maxOutputTokens - this.usedOutputTokens)
  }

  get isExhausted(): boolean {
    return this.usedSteps >= this.maxSteps || this.usedOutputTokens >= this.maxOutputTokens
  }

  get exhaustedReason(): "steps" | "tokens" | null {
    if (this.usedSteps >= this.maxSteps) return "steps"
    if (this.usedOutputTokens >= this.maxOutputTokens) return "tokens"
    return null
  }

  get details(): {
    usedSteps: number
    maxSteps: number
    usedOutputTokens: number
    maxOutputTokens: number
  } {
    return {
      usedSteps: this.usedSteps,
      maxSteps: this.maxSteps,
      usedOutputTokens: this.usedOutputTokens,
      maxOutputTokens: this.maxOutputTokens,
    }
  }

  reset(): void {
    this.usedSteps = 0
    this.usedOutputTokens = 0
  }
}
