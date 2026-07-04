import type {
  PendingAction,
  PendingActionType,
  PendingActionStatus,
} from "./types.js"

let _nextId = 0
function nextId(): string {
  return `pa_${++_nextId}`
}

export class PendingActionManager {
  private actions: PendingAction[] = []
  private readonly EXPIRY_MS = 30 * 60 * 1000

  create(input: {
    type: PendingActionType
    title: string
    description: string
    toolName: string
    toolArguments: Record<string, unknown>
    conversationSummary: string
    approvalRequired?: boolean
  }): PendingAction {
    const action: PendingAction = {
      id: nextId(),
      createdAt: new Date(),
      type: input.type,
      title: input.title,
      description: input.description,
      approvalRequired: input.approvalRequired ?? true,
      status: "pending",
      toolName: input.toolName,
      toolArguments: { ...input.toolArguments },
      conversationSummary: input.conversationSummary,
      expiresAt: new Date(Date.now() + this.EXPIRY_MS),
    }
    this.actions.push(action)
    this.pruneExpired()
    return action
  }

  getLatest(): PendingAction | undefined {
    this.pruneExpired()
    for (let i = this.actions.length - 1; i >= 0; i--) {
      const a = this.actions[i]
      if (a.status === "pending" || a.status === "approved") return a
    }
    return undefined
  }

  getById(id: string): PendingAction | undefined {
    return this.actions.find((a) => a.id === id)
  }

  approve(id?: string): PendingAction | undefined {
    this.pruneExpired()
    const target = id
      ? this.actions.find((a) => a.id === id && a.status === "pending")
      : this.getLatest()
    if (!target || target.status !== "pending") return undefined
    target.status = "approved"
    return target
  }

  reject(id?: string): PendingAction | undefined {
    this.pruneExpired()
    const target = id
      ? this.actions.find((a) => a.id === id && a.status === "pending")
      : this.getLatest()
    if (!target || target.status !== "pending") return undefined
    target.status = "cancelled"
    return target
  }

  startExecuting(id?: string): PendingAction | undefined {
    const target = id
      ? this.actions.find((a) => a.id === id && a.status === "approved")
      : this.actions.find((a) => a.status === "approved")
    if (!target) return undefined
    target.status = "executing"
    return target
  }

  complete(id: string, result: unknown): void {
    const target = this.actions.find((a) => a.id === id)
    if (!target) return
    target.status = "completed"
    target.result = result
  }

  fail(id: string, error: string): void {
    const target = this.actions.find((a) => a.id === id)
    if (!target) return
    target.status = "failed"
    target.error = error
  }

  listPending(): PendingAction[] {
    this.pruneExpired()
    return this.actions.filter((a) => a.status === "pending")
  }

  listAll(): PendingAction[] {
    return [...this.actions]
  }

  getLatestPendingToolCall(): { toolName: string; args: Record<string, unknown> } | undefined {
    const latest = this.getLatest()
    if (!latest) return undefined
    return { toolName: latest.toolName, args: latest.toolArguments }
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const action of this.actions) {
      if (
        (action.status === "pending" || action.status === "approved") &&
        action.expiresAt &&
        action.expiresAt.getTime() < now
      ) {
        action.status = "expired"
      }
    }
  }
}
