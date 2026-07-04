import type { ConversationTurn, TrackedEntity, PendingAction } from "./types.js"
import { EntityStore } from "./entity-store.js"
import { PendingActionManager } from "./pending-action.js"
import { ReferenceResolver, type ReferenceResolution } from "./reference-resolver.js"
import type { WorkspaceMapping } from "./workspace-mapper.js"
import { inferWorkspace, isDocumentRequest } from "./workspace-mapper.js"
import { isApprovalOrRejection } from "./types.js"

export class ConversationState {
  entityStore: EntityStore
  pendingActions: PendingActionManager
  referenceResolver: ReferenceResolver
  turns: ConversationTurn[] = []
  private maxTurns = 50

  constructor() {
    this.entityStore = new EntityStore()
    this.pendingActions = new PendingActionManager()
    this.referenceResolver = new ReferenceResolver(this.entityStore, this.pendingActions)
  }

  addTurn(turn: ConversationTurn): void {
    this.turns.push(turn)
    if (this.turns.length > this.maxTurns) {
      this.turns.shift()
    }
  }

  registerEntity(entity: Omit<TrackedEntity, "id" | "createdAt">): TrackedEntity {
    return this.entityStore.register(entity)
  }

  getActiveContext(): string {
    const ctx = this.entityStore.getActiveContext()
    const parts: string[] = []

    if (ctx.currentRepo) parts.push(`Repo: ${ctx.currentRepo.fullName}`)
    if (ctx.currentBranch) parts.push(`Branch: ${ctx.currentBranch}`)
    if (ctx.currentFile) parts.push(`File: ${ctx.currentFile.path}`)
    if (ctx.currentDriveDoc) parts.push(`Doc: ${ctx.currentDriveDoc.title}`)
    if (ctx.currentSlidesPresentation) parts.push(`Slides: ${ctx.currentSlidesPresentation.title}`)
    if (ctx.currentUploadedFile) parts.push(`Uploaded: ${ctx.currentUploadedFile.filename}`)
    if (ctx.currentSlackChannel) parts.push(`Slack: #${ctx.currentSlackChannel.name}`)
    if (ctx.currentEmailDraft) parts.push(`Draft: ${ctx.currentEmailDraft.subject}`)
    if (ctx.currentCalendarEvent) parts.push(`Event: ${ctx.currentCalendarEvent.title}`)
    if (ctx.currentTicket) parts.push(`Ticket: ${ctx.currentTicket.title}`)
    if (ctx.currentGeneratedArtifact) parts.push(`Artifact: ${ctx.currentGeneratedArtifact.title}`)

    const pending = this.pendingActions.getLatest()
    if (pending && pending.status === "pending") {
      parts.push(`Pending: ${pending.title}`)
    }

    return parts.length > 0 ? parts.join(" | ") : "(none)"
  }

  getPendingActionSummary(): string {
    const pending = this.pendingActions.getLatest()
    if (!pending || pending.status !== "pending") return ""
    return [
      `[Pending Action: ${pending.id}]`,
      `Type: ${pending.type}`,
      `Title: ${pending.title}`,
      `Description: ${pending.description}`,
      pending.expiresAt ? `Expires: ${pending.expiresAt.toISOString()}` : "",
    ].filter(Boolean).join("\n")
  }

  resolveReference(text: string): ReferenceResolution {
    return this.referenceResolver.resolve(text)
  }

  inferWorkspace(text: string): WorkspaceMapping | undefined {
    return inferWorkspace(text)
  }

  isDocumentRequest(text: string): boolean {
    return isDocumentRequest(text)
  }

  getContextualToolArgs(text: string): Record<string, unknown> | null {
    return this.referenceResolver.getToolParametersFromContext(text)
  }

  handleApprovalStatus(text: string): "approved" | "rejected" | "noop" {
    const decision = isApprovalOrRejection(text)
    if (!decision) return "noop"

    if (decision === "approve") {
      const approved = this.pendingActions.approve()
      return approved ? "approved" : "noop"
    }

    if (decision === "reject") {
      const rejected = this.pendingActions.reject()
      return rejected ? "rejected" : "noop"
    }

    return "noop"
  }

  toSystemPromptBlock(): string {
    const ctx = this.getActiveContext()
    const pendingSummary = this.getPendingActionSummary()
    const recentTurns = this.turns.slice(-5).map((t) =>
      `[${t.role === "user" ? "User" : "Assistant"}] ${t.text.slice(0, 200)}`
    ).join("\n")

    const parts: string[] = []
    if (ctx !== "(none)") parts.push(`<active_context>\n${ctx}\n</active_context>`)
    if (pendingSummary) parts.push(`<pending_action>\n${pendingSummary}\n</pending_action>`)
    if (recentTurns) parts.push(`<recent_turns>\n${recentTurns}\n</recent_turns>`)

    return parts.join("\n\n")
  }
}

let _instance: ConversationState | null = null

export function getConversationState(): ConversationState {
  if (!_instance) {
    _instance = new ConversationState()
  }
  return _instance
}

export function resetConversationState(): void {
  _instance = null
}
