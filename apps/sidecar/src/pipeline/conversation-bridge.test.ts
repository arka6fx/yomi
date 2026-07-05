import { describe, expect, it, beforeEach } from "bun:test"
import { registerEntityForToolResult } from "./conversation-bridge.js"
import { getConversationState, resetConversationState } from "../conversation/conversation-state.js"
import { setActiveConversation, resetActiveConversation } from "../conversation/active-conversation.js"

describe("registerEntityForToolResult", () => {
  beforeEach(() => {
    resetConversationState()
    resetActiveConversation()
    setActiveConversation("desktop")
  })

  it("registers gmail-sendEmail results", () => {
    registerEntityForToolResult("gmail-sendEmail", { to: ["a@b.c"], subject: "Hi" }, { messageId: "m1" })
    expect(getConversationState().entityStore.getLatestByType("gmail_message")?.title).toBe("Hi")
  })

  it("does NOT register an entity for a pending-action gate return", () => {
    registerEntityForToolResult(
      "github-createOrUpdateFile",
      { owner: "u", repo: "r", path: "f.go" },
      { id: "pa_x", status: "pending", message: "Approval required: ..." },
    )
    expect(getConversationState().entityStore.getLatestByType("github_file")).toBeUndefined()
  })
})
