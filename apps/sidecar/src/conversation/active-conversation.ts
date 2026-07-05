import { getConversationState } from "./conversation-state.js"

// The sidecar is single-process; pipelines set the key at turn start so
// connector tools (built once per registry init) queue into the right chat.
let _activeKey = "desktop"

export function setActiveConversation(key: string): void {
  _activeKey = key
}

export function getActiveConversation(): string {
  return _activeKey
}

// Test helper: reset _activeKey to its default, mirroring resetConversationState().
export function resetActiveConversation(): void {
  _activeKey = "desktop"
}

export type PendingActionDep = (input: {
  connector: string
  action: string
  risk: "write" | "send" | "paid" | "irreversible"
  title: string
  preview: string
  confirmText?: string
  payload: unknown
}) => Promise<{ id: string; status: string; message: string }>

export function makeSidecarPendingActionDep(): PendingActionDep {
  return async (input) => {
    const state = getConversationState(_activeKey)
    const action = state.pendingActions.create({
      type: input.action,
      title: input.title,
      description: input.preview,
      toolName: input.action,
      toolArguments: (input.payload ?? {}) as Record<string, unknown>,
      conversationSummary: input.title,
    })
    state.persist()
    return {
      id: action.id,
      status: action.status,
      message:
        `Approval required: ${input.title}. ${input.preview}. ` +
        `Ask the user to confirm — reply "yes" to approve or "no" to cancel. Do not retry the tool.`,
    }
  }
}
