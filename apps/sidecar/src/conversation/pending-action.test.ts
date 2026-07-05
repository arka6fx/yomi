import { beforeEach, describe, expect, it } from "bun:test"
import { PendingActionManager } from "./pending-action.js"

describe("PendingActionManager", () => {
  let manager: PendingActionManager

  beforeEach(() => {
    manager = new PendingActionManager()
  })

  it("creates a pending action", () => {
    const action = manager.create({
      type: "github.create_file",
      title: "Create file main.go",
      description: "Create a Go file",
      toolName: "github-createOrUpdateFile",
      toolArguments: {
        owner: "test",
        repo: "repo",
        path: "main.go",
        content: "package main",
        message: "init",
      },
      conversationSummary: "Creating main.go",
    })
    expect(action.id).toBeDefined()
    expect(action.status).toBe("pending")
    expect(action.type).toBe("github.create_file")
  })

  it("getLatest returns the most recent pending action", () => {
    manager.create({
      type: "github.create_file",
      title: "First",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    const second = manager.create({
      type: "github.create_file",
      title: "Second",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    expect(manager.getLatest()?.id).toBe(second.id)
  })

  it("approve changes status to approved", () => {
    const action = manager.create({
      type: "github.create_file",
      title: "Test",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    const approved = manager.approve()
    expect(approved?.id).toBe(action.id)
    expect(approved?.status).toBe("approved")
    expect(manager.getLatest()?.status).toBe("approved")
  })

  it("approve returns undefined when no pending action", () => {
    expect(manager.approve()).toBeUndefined()
  })

  it("reject changes status to cancelled", () => {
    manager.create({
      type: "github.create_file",
      title: "Test",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    const rejected = manager.reject()
    expect(rejected?.status).toBe("cancelled")
    expect(manager.getLatest()).toBeUndefined()
  })

  it("approve by id works", () => {
    const a1 = manager.create({
      type: "github.create_file",
      title: "A",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    const a2 = manager.create({
      type: "github.create_file",
      title: "B",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    const approved = manager.approve(a1.id)
    expect(approved?.id).toBe(a1.id)
    expect(approved?.status).toBe("approved")
    // latest should still be a2 (pending)
    expect(manager.getLatest()?.id).toBe(a2.id)
  })

  it("startExecuting transitions from approved to executing", () => {
    manager.create({
      type: "github.create_file",
      title: "Test",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    manager.approve()
    const executing = manager.startExecuting()
    expect(executing?.status).toBe("executing")
  })

  it("complete sets status to completed with result", () => {
    const action = manager.create({
      type: "github.create_file",
      title: "Test",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    manager.complete(action.id, { url: "https://github.com/test/repo/blob/main/main.go" })
    const a = manager.getById(action.id)
    expect(a?.status).toBe("completed")
    expect(a?.result).toEqual({ url: "https://github.com/test/repo/blob/main/main.go" })
  })

  it("fail sets status to failed with error", () => {
    const action = manager.create({
      type: "github.create_file",
      title: "Test",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    manager.fail(action.id, "GitHub API error")
    const a = manager.getById(action.id)
    expect(a?.status).toBe("failed")
    expect(a?.error).toBe("GitHub API error")
  })

  it("listPending only includes pending actions", () => {
    manager.create({
      type: "github.create_file",
      title: "A",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    const b = manager.create({
      type: "github.create_file",
      title: "B",
      description: "",
      toolName: "t",
      toolArguments: {},
      conversationSummary: "",
    })
    manager.approve(b.id)
    const pending = manager.listPending()
    expect(pending.length).toBe(1)
    expect(pending[0].title).toBe("A")
  })

  it("getLatestPendingToolCall returns tool call info", () => {
    manager.create({
      type: "github.create_file",
      title: "Test",
      description: "",
      toolName: "github-createOrUpdateFile",
      toolArguments: { path: "test.go" },
      conversationSummary: "",
    })
    const info = manager.getLatestPendingToolCall()
    expect(info?.toolName).toBe("github-createOrUpdateFile")
    expect(info?.args).toEqual({ path: "test.go" })
  })
})
