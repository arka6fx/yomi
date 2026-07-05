import { describe, expect, it, beforeEach } from "bun:test"
import { handleApprovalTurn } from "./approval-executor.js"
import { getConversationState, resetConversationState } from "./conversation-state.js"

function seedPending(key: string) {
  getConversationState(key).pendingActions.create({
    type: "github-createOrUpdateFile",
    title: "Create recursion.go in u/golang-practice",
    description: "path: recursion.go",
    toolName: "github-createOrUpdateFile",
    toolArguments: {
      owner: "u",
      repo: "golang-practice",
      path: "recursion.go",
      content: "cGtn",
      message: "add recursion.go",
    },
    conversationSummary: "create recursion.go",
  })
}

describe("handleApprovalTurn", () => {
  beforeEach(() => resetConversationState())

  it("returns null for a normal message", async () => {
    expect(await handleApprovalTurn("what's the weather", "desktop")).toBeNull()
  })

  it("returns null for approval with nothing pending", async () => {
    expect(await handleApprovalTurn("yes", "desktop")).toBeNull()
  })

  it("executes the stored tool call verbatim on approval", async () => {
    seedPending("desktop")
    let calledWith: unknown = null
    const events = await handleApprovalTurn("yes", "desktop", {
      replayTool: async (_name, args) => {
        calledWith = args
        return {
          path: "recursion.go",
          commitSha: "abc1234",
          url: "https://github.com/u/golang-practice/blob/main/recursion.go",
        }
      },
    })
    expect(calledWith).toEqual({
      owner: "u",
      repo: "golang-practice",
      path: "recursion.go",
      content: "cGtn",
      message: "add recursion.go",
    })
    const text = (events ?? [])
      .filter((e) => e.type === "agent_text")
      .map((e) => (e as { text: string }).text)
      .join("")
    expect(text).toContain("recursion.go")
    expect(text).toContain("abc1234")
    expect(getConversationState("desktop").pendingActions.getLatest()).toBeUndefined()
  })

  it("cancels on rejection", async () => {
    seedPending("desktop")
    const events = await handleApprovalTurn("no", "desktop")
    expect(
      events?.some(
        (e) => e.type === "agent_text" && (e as { text: string }).text.includes("Cancelled"),
      ),
    ).toBe(true)
    expect(getConversationState("desktop").pendingActions.listPending()).toHaveLength(0)
  })

  it("marks the action failed and reports the error when replay throws", async () => {
    seedPending("desktop")
    const events = await handleApprovalTurn("approve", "desktop", {
      replayTool: async () => {
        throw new Error("422 name already exists")
      },
    })
    expect(
      events?.some(
        (e) =>
          e.type === "error" ||
          (e.type === "agent_text" && (e as { text: string }).text.includes("failed")),
      ),
    ).toBe(true)
  })
})
