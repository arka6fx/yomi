export { ConversationState, getConversationState, resetConversationState } from "./conversation-state.js"
export { EntityStore } from "./entity-store.js"
export { PendingActionManager } from "./pending-action.js"
export { ReferenceResolver, type ReferenceResolution } from "./reference-resolver.js"
export { inferWorkspace, isDocumentRequest, type WorkspaceMapping } from "./workspace-mapper.js"
export {
  APPROVAL_SYNONYMS,
  REJECTION_SYNONYMS,
  isApproval,
  isRejection,
  isApprovalOrRejection,
  type PendingAction,
  type PendingActionType,
  type PendingActionStatus,
  type TrackedEntity,
  type EntityType,
  type ActiveContext,
  type ConversationTurn,
} from "./types.js"
