import { describe, expect, it, beforeEach, mock } from "bun:test"

// Gmail tools are prefixed "gmail-" but live under the "google" ConnectorDef, so the
// family-guess (`toolName.split("-")[0]` -> "gmail") in replayConnectorTool never
// matches any def.id/prefix — this exercises the full-scan fallback that must still
// locate "gmail-sendEmail" instead of silently reporting "No executor for tool".
mock.module("../connectors/registry.js", () => ({
  getConnectorRegistry: () => ({
    getUserId: () => "user-1",
    getTokenProvider: () => async () => {
      throw new Error("no token in test")
    },
  }),
}))

const { handleApprovalTurn } = await import("./approval-executor.js")
const { getConversationState, resetConversationState } = await import("./conversation-state.js")

describe("handleApprovalTurn — gmail lives under the google def", () => {
  beforeEach(() => resetConversationState())

  it("locates gmail-sendEmail via full-scan fallback rather than the family guess", async () => {
    getConversationState("desktop").pendingActions.create({
      type: "gmail-sendEmail",
      title: "Send email to a@b.com",
      description: "subject: hi",
      toolName: "gmail-sendEmail",
      toolArguments: { to: ["a@b.com"], subject: "hi", body: "hello" },
      conversationSummary: "send email",
    })

    const events = await handleApprovalTurn("yes", "desktop")

    // A genuine "not found" would surface as an error event / "failed" agent_text.
    const noExecutorHit = (events ?? []).some(
      (e) =>
        (e.type === "error" && e.message.includes("No executor for tool")) ||
        (e.type === "agent_text" && e.text.includes("No executor for tool")),
    )
    expect(noExecutorHit).toBe(false)

    const toolResult = (events ?? []).find((e) => e.type === "agent_tool_result") as
      | { type: "agent_tool_result"; tool: string; result: unknown }
      | undefined
    expect(toolResult).toBeDefined()
    expect(toolResult?.tool).toBe("gmail-sendEmail")
    // The connector's own execute() caught our fake token-provider failure and
    // returned a soft error — proof the real gmail-sendEmail tool was invoked.
    expect((toolResult?.result as { error?: string } | undefined)?.error).toBe("no token in test")
  })
})
