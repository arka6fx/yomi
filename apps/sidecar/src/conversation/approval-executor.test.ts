import { describe, expect, it, beforeEach } from "bun:test"
import { handleApprovalTurn } from "./approval-executor.js"
import { getConversationState, resetConversationState } from "./conversation-state.js"
import { setActiveConversation, getActiveConversation } from "./active-conversation.js"
import { toolGuardrail } from "../harness/hooks.js"

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
  beforeEach(() => {
    resetConversationState()
    // Guardrail is a module-level singleton — reset its per-turn counters so
    // repeated identical (toolName, args) failures across test cases don't
    // trip the loop-warning path and mutate the result shape.
    toolGuardrail.resetForTurn()
  })

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

  it("marks the action failed (not completed) when replay soft-fails with { error }", async () => {
    seedPending("desktop")
    const pending = getConversationState("desktop").pendingActions.getLatest()
    const events = await handleApprovalTurn("yes", "desktop", {
      replayTool: async () => ({ error: "expired token" }),
    })
    const text = (events ?? [])
      .filter((e) => e.type === "agent_text")
      .map((e) => (e as { text: string }).text)
      .join("\n")
    expect(text).not.toContain("Done:")
    expect(text).toContain("expired token")
    expect(events?.some((e) => e.type === "error")).toBe(true)
    expect(getConversationState("desktop").pendingActions.getById(pending!.id)?.status).toBe(
      "failed",
    )
  })

  it("marks the action failed when replay soft-fails with { ok: false }", async () => {
    seedPending("desktop")
    const pending = getConversationState("desktop").pendingActions.getLatest()
    const events = await handleApprovalTurn("yes", "desktop", {
      replayTool: async () => ({ ok: false, sha: "abc", message: "not mergeable" }),
    })
    const text = (events ?? [])
      .filter((e) => e.type === "agent_text")
      .map((e) => (e as { text: string }).text)
      .join("\n")
    expect(text).not.toContain("Done:")
    expect(events?.some((e) => e.type === "error")).toBe(true)
    expect(getConversationState("desktop").pendingActions.getById(pending!.id)?.status).toBe(
      "failed",
    )
  })

  it("scopes replay entity registration to the key argument, not the stale active-conversation global", async () => {
    seedPending("desktop")
    setActiveConversation("telegram:999")
    const events = await handleApprovalTurn("yes", "desktop", {
      replayTool: async () => ({
        path: "recursion.go",
        commitSha: "abc1234",
        url: "https://github.com/u/golang-practice/blob/main/recursion.go",
      }),
    })
    expect(events?.some((e) => e.type === "done")).toBe(true)
    expect(getActiveConversation()).toBe("desktop")
    expect(
      getConversationState("desktop").entityStore.getActiveContext().currentFile?.path,
    ).toBe("recursion.go")
    expect(
      getConversationState("telegram:999").entityStore.getActiveContext().currentFile,
    ).toBeUndefined()
  })
})
