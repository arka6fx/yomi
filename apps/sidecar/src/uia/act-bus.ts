import type { SseEvent, UiaAction } from "@yomi/shared"
import { confirmRisky } from "./safety.js"

// Cross-process confirmation channel for Act mode (Spec 16).
// A risky tool emits `act_proposed` on the live agent SSE stream and awaits a decision that
// arrives out-of-band via POST /act/confirm. Single active run at a time (single-user desktop).

type Emit = (e: SseEvent) => void

const CONFIRM_TIMEOUT_MS = 30_000

let emit: Emit | null = null
let seq = 0
const pending = new Map<string, (approved: boolean) => void>()

// The agent pipeline sets this to a writer into the active stream for the duration of a run.
export function setActEmitter(fn: Emit | null): void {
  emit = fn
  if (!fn) {
    // Stream ended: deny anything still waiting so tools don't hang.
    for (const resolve of pending.values()) resolve(false)
    pending.clear()
  }
}

type Rect = { x: number; y: number; width: number; height: number }

export function emitActResult(ok: boolean, label: string, detail?: string): void {
  emit?.({ type: "act_result", ok, label, detail })
}

// Speak/show a line on the live stream (e.g. read a confirmation question aloud before pausing).
export function emitAgentText(text: string): void {
  emit?.({ type: "agent_text", text })
}

// Ask the desktop to confirm a risky action. Falls back to the safety confirmer (autoconfirm /
// registered handler) when there's no live stream to prompt on — keeps tests/headless runs working.
export function requestConfirmation(
  action: UiaAction,
  label: string,
  reason: string,
  rect?: Rect,
): Promise<boolean> {
  if (!emit) return confirmRisky(label, reason)
  const id = `act${++seq}`
  emit({ type: "act_proposed", id, action, label, risky: true, rect })
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) resolve(false) // no answer in time → deny
    }, CONFIRM_TIMEOUT_MS)
    pending.set(id, (approved) => {
      clearTimeout(timer)
      resolve(approved)
    })
  })
}

// Called by POST /act/confirm. Returns false if the id is unknown/expired.
export function resolveConfirmation(id: string, approved: boolean): boolean {
  const resolve = pending.get(id)
  if (!resolve) return false
  pending.delete(id)
  resolve(approved)
  return true
}
