import { describe, expect, it, beforeEach } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  setActiveConversation,
  getActiveConversation,
  resetActiveConversation,
  makeSidecarPendingActionDep,
} from "./active-conversation.js"
import {
  getConversationState,
  resetConversationState,
  flushAllConversationStates,
} from "./conversation-state.js"

// Mirrors persistence.ts's stateFile() — used only to read/clean up between runs.
function stateFilePath(key: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
  return join(home, ".yomi", "state", `conversation-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
}

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

  it("persists the pending action to disk synchronously — no explicit flush needed", async () => {
    const key = "restart-safety-test"
    const path = stateFilePath(key)
    try {
      rmSync(path)
    } catch {
      // ignore — file may not exist yet
    }
    setActiveConversation(key)
    const dep = makeSidecarPendingActionDep()
    await dep({
      connector: "github", action: "github-createOrUpdateFile", risk: "write",
      title: "Create recursion.go in u/golang-practice",
      preview: "path: recursion.go", payload: { owner: "u", repo: "golang-practice", path: "recursion.go", content: "x" },
    })

    // No flushPendingSave() call here — production code must have already
    // written it synchronously, simulating a process kill right after the
    // dep's promise resolves (well within the old 400ms debounce window).
    const onDisk = JSON.parse(readFileSync(path, "utf-8")) as {
      pendingActions: Array<{ toolName: string }>
    }
    expect(onDisk.pendingActions.some((a) => a.toolName === "github-createOrUpdateFile")).toBe(
      true,
    )
  })

  it("flushAllConversationStates writes every live instance to disk", () => {
    const keyA = "flush-all-a"
    const keyB = "flush-all-b"
    const pathA = stateFilePath(keyA)
    const pathB = stateFilePath(keyB)
    for (const p of [pathA, pathB]) {
      try {
        rmSync(p)
      } catch {
        // ignore — file may not exist yet
      }
    }

    // registerEntity()'s persist() is debounced — nothing on disk yet.
    getConversationState(keyA).registerEntity({
      type: "github_repo",
      title: "repo-a",
      summary: "u/repo-a",
      metadata: {},
    })
    getConversationState(keyB).registerEntity({
      type: "github_repo",
      title: "repo-b",
      summary: "u/repo-b",
      metadata: {},
    })

    flushAllConversationStates()

    const onDiskA = JSON.parse(readFileSync(pathA, "utf-8")) as { entities: unknown[] }
    const onDiskB = JSON.parse(readFileSync(pathB, "utf-8")) as { entities: unknown[] }
    expect(onDiskA.entities.length).toBeGreaterThan(0)
    expect(onDiskB.entities.length).toBeGreaterThan(0)
  })
})
