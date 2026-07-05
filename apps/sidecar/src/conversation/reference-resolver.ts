import type { TrackedEntity, EntityType, ActiveContext } from "./types.js"
import { EntityStore } from "./entity-store.js"
import { PendingActionManager } from "./pending-action.js"
import { isApprovalOrRejection } from "./types.js"

const PRIMARY_REFERENCE_WORDS = new Set(["it", "this", "that", "the", "one"])
const LOCATION_REFERENCE_WORDS = new Set(["there"])
const DEMONSTRATIVE_REFERENCE = new Set(["this", "that"])
const SHOW_VERBS = new Set(["show", "display", "open", "view", "read", "get", "see"])
const ACTION_VERBS = new Set([
  "rename",
  "update",
  "edit",
  "modify",
  "change",
  "commit",
  "push",
  "delete",
  "remove",
  "move",
  "copy",
  "translate",
  "summarize",
  "extract",
  "convert",
  "create",
  "make",
  "generate",
  "send",
  "share",
  "export",
])

const TOOL_TYPE_MAP: Record<string, EntityType> = {
  file: "github_file",
  repo: "github_repo",
  repository: "github_repo",
  pr: "github_pr",
  issue: "github_issue",
  commit: "github_commit",
  event: "calendar_event",
  doc: "drive_doc",
  document: "drive_doc",
  folder: "drive_folder",
  slide: "slides_presentation",
  presentation: "slides_presentation",
  email: "gmail_message",
  draft: "gmail_draft",
  message: "slack_message",
  channel: "slack_channel",
  ticket: "linear_ticket",
  page: "notion_page",
  upload: "uploaded_file",
  artifact: "generated_artifact",
}

export interface ReferenceResolution {
  type:
    | "pending_action_approval"
    | "pending_action_rejection"
    | "entity_reference"
    | "active_context"
    | "search_result"
    | "unresolved"
  target?: TrackedEntity
  pendingActionId?: string
  reason: string
}

export class ReferenceResolver {
  constructor(
    private entityStore: EntityStore,
    private pendingActions: PendingActionManager,
  ) {}

  resolve(text: string): ReferenceResolution {
    const trimmed = text.trim().toLowerCase()

    const approval = isApprovalOrRejection(text)
    if (approval) {
      const pending = this.pendingActions.getLatest()
      if (pending) {
        return {
          type: approval === "approve" ? "pending_action_approval" : "pending_action_rejection",
          pendingActionId: pending.id,
          reason: `${approval === "approve" ? "Approving" : "Rejecting"}: ${pending.title}`,
        }
      }
    }

    const entityRef = this.resolveEntityReference(trimmed)
    if (entityRef) return entityRef

    const ctxRef = this.resolveActiveContext(trimmed)
    if (ctxRef) return ctxRef

    return { type: "unresolved", reason: "Could not resolve reference" }
  }

  private resolveEntityReference(text: string): ReferenceResolution | null {
    const words = text.split(/\s+/)
    let targetEntityType: EntityType | undefined

    const noun = words.find((w) => TOOL_TYPE_MAP[w])
    if (noun) targetEntityType = TOOL_TYPE_MAP[noun]

    if (targetEntityType) {
      const entity = this.entityStore.getLatestByType(targetEntityType)
      if (entity) {
        return {
          type: "entity_reference",
          target: entity,
          reason: `Found ${targetEntityType}: ${entity.title}`,
        }
      }
    }

    const hasPrimaryRef = words.some((w) => PRIMARY_REFERENCE_WORDS.has(w))
    const hasShowVerb = words.some((w) => SHOW_VERBS.has(w))

    if (hasPrimaryRef || hasShowVerb) {
      const allTypes: EntityType[] = [
        "github_file",
        "uploaded_file",
        "drive_doc",
        "slides_presentation",
        "github_repo",
        "github_pr",
        "github_issue",
        "gmail_draft",
        "gmail_message",
        "slack_message",
        "linear_ticket",
      ]
      for (const t of allTypes) {
        const entity = this.entityStore.getLatestByType(t)
        if (entity) {
          return {
            type: "entity_reference",
            target: entity,
            reason: `Reference "${hasPrimaryRef ? words.find((w) => PRIMARY_REFERENCE_WORDS.has(w)) : "it"}" resolved to ${t}: ${entity.title}`,
          }
        }
      }
    }

    return null
  }

  private resolveActiveContext(text: string): ReferenceResolution | null {
    const ctx = this.entityStore.getActiveContext()
    const words = text.split(/\s+/)

    if (words.some((w) => SHOW_VERBS.has(w) || DEMONSTRATIVE_REFERENCE.has(w))) {
      for (const key of Object.keys(ctx) as (keyof ActiveContext)[]) {
        const val = ctx[key]
        if (val && typeof val === "object" && "title" in (val as Record<string, unknown>)) {
          const v = val as Record<string, string>
          return {
            type: "active_context",
            reason: `Using active context ${key}: ${v.title}`,
          }
        }
      }
    }

    if (words.some((w) => LOCATION_REFERENCE_WORDS.has(w))) {
      const repo = ctx.currentRepo
      if (repo) {
        return {
          type: "active_context",
          reason: `Using current repository: ${repo.fullName}`,
        }
      }
    }

    return null
  }

  getToolParametersFromContext(text: string): Record<string, unknown> | null {
    const ctx = this.entityStore.getActiveContext()
    const params: Record<string, unknown> = {}
    let found = false

    if (ctx.currentRepo) {
      params.owner = ctx.currentRepo.owner
      params.repo = ctx.currentRepo.repo
      found = true
    }
    if (ctx.currentBranch) {
      params.branch = ctx.currentBranch
      found = true
    }
    if (ctx.currentFile) {
      params.path = ctx.currentFile.path
    }

    return found ? params : null
  }
}
