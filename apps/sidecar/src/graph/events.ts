import type { AutomationState, AutomationTimelineItem, SseEvent } from "@yomi/shared"
import {
  completeAutomation,
  failAutomation,
  recoveringAutomation,
  stepAutomation,
  timelineAutomation,
  waitingAutomation,
  type AutomationSession,
} from "../automation/runs.js"

type TimelineStatus = AutomationTimelineItem["status"]

// Maps graph-node lifecycle to the EXISTING automation_* SSE events so the desktop Dynamic
// Island needs no change. A thin façade over automation/runs.ts bound to one run + emitter.
export class EventBridge {
  constructor(
    private readonly session: AutomationSession,
    private readonly emit: (e: SseEvent) => void,
  ) {}

  step(
    currentStep: string,
    opts: { state?: AutomationState; nextStep?: string; step?: number; maxSteps?: number } = {},
  ): void {
    this.emit(stepAutomation(this.session, currentStep, opts))
  }

  timeline(label: string, status: TimelineStatus, detail?: string): void {
    this.emit(timelineAutomation(this.session, label, status, detail))
  }

  waiting(reason: string, risk: "safe" | "moderate" | "dangerous"): void {
    this.emit(waitingAutomation(this.session, reason, risk))
  }

  recovering(reason: string): void {
    this.emit(recoveringAutomation(this.session, reason))
  }

  complete(summary: string): void {
    this.emit(completeAutomation(this.session, summary))
  }

  fail(error: string): void {
    this.emit(failAutomation(this.session, error))
  }

  raw(event: SseEvent): void {
    this.emit(event)
  }
}
