import { describe, expect, it, beforeEach } from "bun:test"
import { rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  getConversationState,
  resetConversationState,
} from "./conversation-state.js"
import { setActiveConversation, makeSidecarPendingActionDep } from "./active-conversation.js"
import { handleApprovalTurn } from "./approval-executor.js"
import { registerEntityForToolResult } from "../pipeline/conversation-bridge.js"

const KEY = "e2e-test"
// Mirrors persistence.ts's stateFile() — used only to clean up between runs.
const stateFile = join(
  process.env.HOME ?? process.env.USERPROFILE ?? homedir(),
  ".yomi",
  "state",
  `conversation-${KEY}.json`,
)

describe("success-criteria conversation flow", () => {
  beforeEach(() => {
    resetConversationState()
    try {
      rmSync(stateFile)
    } catch {
      // ignore — file may not exist yet
    }
    setActiveConversation(KEY)
  })

  it("create -> approve -> active entity -> survives restart", async () => {
    // Turn 1: agent hits the gate — tool returns "approval required" instead of executing.
    const dep = makeSidecarPendingActionDep()
    const gate = await dep({
      connector: "github",
      action: "github-createOrUpdateFile",
      risk: "write",
      title: "Create recursion.go in u/golang-practice",
      preview: "path: recursion.go",
      payload: {
        owner: "u",
        repo: "golang-practice",
        path: "recursion.go",
        content: "cGtn",
        message: "add recursion.go",
      },
    })
    expect(gate.status).toBe("pending")
    expect(gate.message).toContain("Approval required")

    // Prompt for turn 2 must carry the pending action — no context loss across the turn.
    expect(getConversationState(KEY).toSystemPromptBlock()).toContain("Create recursion.go")

    // Simulated sidecar restart: flush the debounced write, drop the in-memory
    // instance, then prove a fresh getConversationState() reloads from disk.
    getConversationState(KEY).flushPendingSave()
    resetConversationState(KEY)
    expect(getConversationState(KEY).pendingActions.getLatest()?.toolName).toBe(
      "github-createOrUpdateFile",
    )

    // Turn 2: "yes" executes the STORED args — nothing re-asked, nothing rebuilt.
    let replayed: Record<string, unknown> | null = null
    const events = await handleApprovalTurn("yes", KEY, {
      replayTool: async (_name, args) => {
        replayed = args
        return {
          path: "recursion.go",
          commitSha: "abc1234",
          url: "https://github.com/u/golang-practice/blob/main/recursion.go",
        }
      },
    })
    expect(replayed).toEqual({
      owner: "u",
      repo: "golang-practice",
      path: "recursion.go",
      content: "cGtn",
      message: "add recursion.go",
    })
    expect(events?.some((e) => e.type === "done")).toBe(true)

    // Turn 3: the created file becomes the active entity via hooks.onPostToolUse ->
    // registerEntityForToolResult, so "show me" / "it" resolve without re-asking.
    const ctx = getConversationState(KEY).entityStore.getActiveContext()
    expect(ctx.currentFile?.path).toBe("recursion.go")

    // A second "yes" with nothing pending falls through to normal routing.
    expect(await handleApprovalTurn("yes", KEY)).toBeNull()
  })

  it("upload -> 'summarize it' context", () => {
    registerEntityForToolResult(
      "read_document",
      { url: "https://x/obc.pdf", mimeType: "application/pdf" },
      { text: "PDF CONTENT" },
    )
    const block = getConversationState(KEY).toSystemPromptBlock()
    expect(block).toContain("obc.pdf")
  })
})
