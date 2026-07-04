import type { Hooks } from "./hooks.js"
import { runPromotionCycle, getMemoryStats } from "../memory/promotion.js"

export enum SessionState {
  IDLE = "IDLE",
  LISTENING = "LISTENING",
  ROUTING = "ROUTING",
  FAST_PIPELINE = "FAST_PIPELINE",
  AGENT_RUNNING = "AGENT_RUNNING",
  COMPACTING = "COMPACTING",
}

export type SessionEvent =
  | "hotkey_press"
  | "vad_end"
  | "manual_release"
  | "route_fast"
  | "route_agent"
  | "tts_complete"
  | "task_complete"
  | "user_cancel"
  | "max_iterations"
  | "error"
  | "memory_written"

type TransitionTable = Partial<Record<SessionEvent, SessionState>>

const TRANSITIONS: Record<SessionState, TransitionTable> = {
  [SessionState.IDLE]: {
    hotkey_press: SessionState.LISTENING,
  },
  [SessionState.LISTENING]: {
    vad_end: SessionState.ROUTING,
    manual_release: SessionState.ROUTING,
  },
  [SessionState.ROUTING]: {
    route_fast: SessionState.FAST_PIPELINE,
    route_agent: SessionState.AGENT_RUNNING,
  },
  [SessionState.FAST_PIPELINE]: {
    tts_complete: SessionState.IDLE,
    error: SessionState.IDLE,
  },
  [SessionState.AGENT_RUNNING]: {
    task_complete: SessionState.COMPACTING,
    user_cancel: SessionState.COMPACTING,
    max_iterations: SessionState.COMPACTING,
    error: SessionState.COMPACTING,
  },
  [SessionState.COMPACTING]: {
    memory_written: SessionState.IDLE,
  },
}

export class SessionMachine {
  state: SessionState = SessionState.IDLE
  private hooks: Hooks

  constructor(hooks: Hooks) {
    this.hooks = hooks
  }

  // Call before transition('route_fast') or transition('route_agent') to fire
  // the onUserPromptSubmit hook with the resolved prompt text.
  async submit(prompt: string): Promise<void> {
    await this.hooks.onUserPromptSubmit(prompt)
  }

  async transition(event: SessionEvent): Promise<SessionState> {
    const next = TRANSITIONS[this.state]?.[event]
    if (!next) {
      console.warn(`[yomi/sm] ignored: ${this.state} + ${event} (no transition)`)
      return this.state
    }

    const prev = this.state
    this.state = next

    // Fire lifecycle hooks at boundaries.
    if (prev === SessionState.IDLE && next === SessionState.LISTENING) {
      await this.hooks.onSessionStart()
    }

    // COMPACTING: run lightweight memory promotion before returning to IDLE.
    if (next === SessionState.COMPACTING) {
      this.runCompaction().catch((err) =>
        console.warn("[yomi/sm] compaction failed:", err instanceof Error ? err.message : err)
      )
    }

    // Return to IDLE after compaction or a fast-path error.
    if (next === SessionState.IDLE) {
      await this.hooks.onSessionEnd()
    }

    return this.state
  }

  private async runCompaction(): Promise<void> {
    try {
      const [promoResult, statsBefore] = await Promise.all([
        runPromotionCycle({ minScore: 0.8, minRecalls: 2 }),
        getMemoryStats().catch(() => ({ promoted: 0, totalCandidates: 0, promotedSize: 0 })),
      ])

      if (promoResult.promoted > 0 || promoResult.pruned > 0) {
        console.warn(
          `[yomi/sm] compaction: ${promoResult.promoted} promoted, ${promoResult.pruned} pruned, ${promoResult.droppedDates.length} sections dropped`,
        )
      }

      const statsAfter = await getMemoryStats().catch(() => ({ promoted: 0, totalCandidates: 0, promotedSize: 0 }))
      if (statsAfter.promotedSize !== statsBefore.promotedSize) {
        console.warn(`[yomi/sm] MEMORY.md: ${statsBefore.promotedSize} → ${statsAfter.promotedSize} chars`)
      }

      // Emit memory_written to complete the COMPACTING → IDLE transition
      this.state = SessionState.IDLE
      await this.hooks.onSessionEnd()
    } catch {
      // If compaction fails, still transition to IDLE
      this.state = SessionState.IDLE
      await this.hooks.onSessionEnd()
    }
  }
}
