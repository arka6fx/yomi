import { randomBytes } from "node:crypto"

export type RemoteAction = "screenshot" | "voice" | "move" | "text"

export interface RemoteTrigger {
  id: string
  action: RemoteAction
  payload: Record<string, string>
  createdAt: number
}

interface PendingTrigger extends RemoteTrigger {
  resolve: (result: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const TRIGGER_TIMEOUT_MS = 30_000

const pending = new Map<string, PendingTrigger>()

// Enqueue a trigger and wait for the desktop to respond with a result.
export function enqueueTrigger(action: RemoteAction, payload: Record<string, string> = {}): Promise<string> {
  const id = randomBytes(8).toString("hex")
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error("Remote trigger timed out — is the Yomi desktop open?"))
    }, TRIGGER_TIMEOUT_MS)

    pending.set(id, { id, action, payload, createdAt: Date.now(), resolve, reject, timer })
  })
}

// Called by GET /remote/pending — returns all queued triggers and clears the queue.
export function consumePending(): RemoteTrigger[] {
  const triggers: RemoteTrigger[] = []
  for (const t of pending.values()) {
    triggers.push({ id: t.id, action: t.action, payload: t.payload, createdAt: t.createdAt })
  }
  return triggers
}

// Called by POST /remote/result — resolves the waiting enqueueTrigger promise.
export function resolveTrigger(id: string, text: string): boolean {
  const t = pending.get(id)
  if (!t) return false
  clearTimeout(t.timer)
  pending.delete(id)
  t.resolve(text)
  return true
}

export function rejectTrigger(id: string, error: string): boolean {
  const t = pending.get(id)
  if (!t) return false
  clearTimeout(t.timer)
  pending.delete(id)
  t.reject(new Error(error))
  return true
}
