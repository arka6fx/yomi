export type AgentState = "idle" | "thinking" | "working" | "waiting" | "error"

export class AgentStateMachine {
  state: AgentState
  private startedAt = performance.now()

  constructor(initial: AgentState = "idle") {
    this.state = initial
  }

  transition(next: AgentState): void {
    if (this.state === next) return
    this.state = next
    this.startedAt = performance.now()
  }

  get ageMs(): number {
    return performance.now() - this.startedAt
  }
}
