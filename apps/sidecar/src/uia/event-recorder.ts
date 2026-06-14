import type { FocusChangeEvent, UiaAction } from "@yomi/shared"
import { uia } from "./client.js"

export type UiaRecordedEvent = {
  seq: number
  at: string
  kind: "focus" | "structure" | "property" | "selection" | "invoke" | "tab_stop"
  window?: string
  hwnd?: number
  ref?: string
  action?: UiaAction
  detail?: Record<string, unknown>
}

export class UiaEventRecorder {
  private seq = 0
  private readonly events: UiaRecordedEvent[] = []
  private previousFocusHandler: ((event: FocusChangeEvent) => void) | null = null
  private active = false

  start(): void {
    if (this.active) return
    this.active = true
    this.previousFocusHandler = uia.onFocusChange
    uia.onFocusChange = (event) => {
      this.recordFocus(event)
      this.previousFocusHandler?.(event)
    }
  }

  stop(): UiaRecordedEvent[] {
    if (this.active) {
      uia.onFocusChange = this.previousFocusHandler
      this.previousFocusHandler = null
      this.active = false
    }
    return this.snapshot()
  }

  record(kind: UiaRecordedEvent["kind"], detail: Omit<UiaRecordedEvent, "seq" | "at" | "kind"> = {}): UiaRecordedEvent {
    const event: UiaRecordedEvent = { seq: ++this.seq, at: new Date().toISOString(), kind, ...detail }
    this.events.push(event)
    return event
  }

  recordFocus(event: FocusChangeEvent): UiaRecordedEvent {
    return this.record("focus", { hwnd: event.hwnd, window: event.window })
  }

  snapshot(): UiaRecordedEvent[] {
    return this.events.map((event) => ({ ...event, detail: event.detail ? { ...event.detail } : undefined }))
  }

  serialize(): string {
    return JSON.stringify({ events: this.snapshot() }, null, 2)
  }
}

export function createUiaEventRecorder(): UiaEventRecorder {
  return new UiaEventRecorder()
}
