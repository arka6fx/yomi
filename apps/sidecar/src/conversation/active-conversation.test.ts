import { describe, expect, it, beforeEach } from "bun:test"
import {
  setActiveConversation,
  getActiveConversation,
  resetActiveConversation,
  makeSidecarPendingActionDep,
} from "./active-conversation.js"
import { getConversationState, resetConversationState } from "./conversation-state.js"

describe("sidecar pending-action dep", () => {
  beforeEach(() => {
    resetConversationState()
    resetActiveConversation()
  })

  it("queues a pending action in the active conversation and returns approval message", async () => {
    setActiveConversation("telegram:42")
    const dep = makeSidecarPendingActionDep()
    const res = await dep({
      connector: "github", action: "github-createOrUpdateFile", risk: "write",
      title: "Create recursion.go in u/golang-practice",
      preview: "path: recursion.go", payload: { owner: "u", repo: "golang-practice", path: "recursion.go", content: "x" },
    })
    expect(res.status).toBe("pending")
    expect(res.message).toContain("Approval required")
    const pending = getConversationState("telegram:42").pendingActions.getLatest()
    expect(pending?.toolName).toBe("github-createOrUpdateFile")
    expect(pending?.toolArguments).toEqual({ owner: "u", repo: "golang-practice", path: "recursion.go", content: "x" })
  })

  it("defaults active conversation to desktop", () => {
    expect(getActiveConversation()).toBe("desktop")
  })
})
