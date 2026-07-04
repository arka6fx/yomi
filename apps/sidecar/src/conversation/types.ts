export type PendingActionType =
  | "github.create_file"
  | "github.create_repo"
  | "github.create_issue"
  | "github.create_pr"
  | "github.merge_pr"
  | "github.review_pr"
  | "github.comment"
  | "github.create_branch"
  | "github.update_issue"
  | "calendar.create_event"
  | "drive.create_doc"
  | "drive.create_folder"
  | "slides.create"
  | "gmail.send"
  | "gmail.draft"
  | "slack.send_message"
  | "linear.create_issue"
  | "notion.create_page"
  | "bash.command"
  | "memory.add"
  | "generic.write"

export type PendingActionStatus =
  | "pending"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"

export interface PendingAction {
  id: string
  createdAt: Date
  type: PendingActionType
  title: string
  description: string
  approvalRequired: boolean
  status: PendingActionStatus
  toolName: string
  toolArguments: Record<string, unknown>
  conversationSummary: string
  result?: unknown
  error?: string
  expiresAt?: Date
}

export type EntityType =
  | "github_repo"
  | "github_file"
  | "github_pr"
  | "github_issue"
  | "github_commit"
  | "calendar_event"
  | "drive_doc"
  | "drive_folder"
  | "slides_presentation"
  | "gmail_draft"
  | "gmail_message"
  | "slack_message"
  | "slack_channel"
  | "linear_ticket"
  | "notion_page"
  | "uploaded_file"
  | "generated_artifact"
  | "web_search_result"
  | "memory_entry"
  | "bash_result"

export interface TrackedEntity {
  id: string
  type: EntityType
  title: string
  summary: string
  createdAt: Date
  metadata: Record<string, unknown>
  toolResult?: unknown
}

export interface ActiveContext {
  currentRepo?: { owner: string; repo: string; fullName: string }
  currentBranch?: string
  currentFile?: { path: string; repo: string }
  currentFolder?: string
  currentDriveDoc?: { id: string; title: string; url: string }
  currentSlidesPresentation?: { id: string; title: string; url: string }
  currentUploadedFile?: { id: string; filename: string; mimeType: string }
  currentSlackChannel?: { id: string; name: string }
  currentEmailDraft?: { id: string; to: string; subject: string }
  currentCalendarEvent?: { id: string; title: string; startTime: string }
  currentTicket?: { id: string; title: string; system: string }
  currentPendingAction?: PendingAction
  currentGeneratedArtifact?: { id: string; type: string; title: string }
}

export interface ConversationTurn {
  role: "user" | "assistant"
  text: string
  timestamp: Date
  entities?: TrackedEntity[]
  toolCalls?: { tool: string; args: unknown; result: unknown }[]
}

export interface ConversationStateData {
  turns: ConversationTurn[]
  entities: Map<string, TrackedEntity>
  activeContext: ActiveContext
  pendingActions: PendingAction[]
  recentToolResults: Map<string, unknown[]>
}

export const APPROVAL_SYNONYMS = new Set([
  "yes", "yup", "yep", "sure", "do it", "go ahead", "proceed",
  "confirm", "approved", "approve", "/approve", "okay", "ok",
  "sounds good", "yeah", "y", "aye", "go for it",
])

export const REJECTION_SYNONYMS = new Set([
  "cancel", "no", "stop", "never mind", "don't", "reject",
  "deny", "nope", "nah", "forget it", "skip", "dismiss", "/deny",
  "not now", "later",
])

export function isApproval(text: string): boolean {
  return APPROVAL_SYNONYMS.has(text.trim().toLowerCase())
}

export function isRejection(text: string): boolean {
  return REJECTION_SYNONYMS.has(text.trim().toLowerCase())
}

export function isApprovalOrRejection(text: string): "approve" | "reject" | null {
  const t = text.trim().toLowerCase()
  if (APPROVAL_SYNONYMS.has(t)) return "approve"
  if (REJECTION_SYNONYMS.has(t)) return "reject"
  return null
}
