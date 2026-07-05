import { describe, expect, it } from "bun:test"
import { ConversationState } from "./conversation-state.js"
import { serializeState, hydrateState } from "./persistence.js"

describe("conversation persistence", () => {
  it("round-trips pending actions, entities, and turns", () => {
    const a = new ConversationState()
    a.pendingActions.create({
      type: "github-createOrUpdateFile",
      title: "Create recursion.go",
      description: "commit to main",
      toolName: "github-createOrUpdateFile",
      toolArguments: { owner: "u", repo: "golang-practice", path: "recursion.go" },
      conversationSummary: "user asked to create recursion.go",
    })
    a.registerEntity({
      type: "github_repo",
      title: "u/golang-practice",
      summary: "repo",
      metadata: { owner: "u", repo: "golang-practice", fullName: "u/golang-practice" },
    })
    a.addTurn({ role: "user", text: "create recursion.go", timestamp: new Date() })

    const b = new ConversationState()
    hydrateState(b, serializeState(a))

    const pending = b.pendingActions.getLatest()
    expect(pending?.toolName).toBe("github-createOrUpdateFile")
    expect(pending?.toolArguments).toEqual({
      owner: "u",
      repo: "golang-practice",
      path: "recursion.go",
    })
    expect(b.entityStore.getActiveContext().currentRepo?.fullName).toBe("u/golang-practice")
    expect(b.turns).toHaveLength(1)
  })

  it("revives Date fields so expiry pruning still works", () => {
    const a = new ConversationState()
    a.pendingActions.create({
      type: "t",
      title: "t",
      description: "d",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "s",
    })
    const b = new ConversationState()
    hydrateState(b, serializeState(a))
    expect(b.pendingActions.getLatest()?.expiresAt).toBeInstanceOf(Date)
  })
})
