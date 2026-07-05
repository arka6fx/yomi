import { beforeEach, describe, expect, it } from "bun:test"
import { EntityStore } from "./entity-store.js"

describe("EntityStore", () => {
  let store: EntityStore

  beforeEach(() => {
    store = new EntityStore()
  })

  it("registers and retrieves entities by id", () => {
    const entity = store.register({
      type: "github_repo",
      title: "owner/repo",
      summary: "A test repo",
      metadata: { owner: "owner", repo: "repo" },
    })
    expect(entity.id).toBeDefined()
    expect(entity.type).toBe("github_repo")
    expect(store.get(entity.id)).toBeDefined()
  })

  it("returns latest by type", () => {
    store.register({
      type: "github_file",
      title: "file1.go",
      summary: "First file",
      metadata: {},
    })
    const latest = store.register({
      type: "github_file",
      title: "file2.go",
      summary: "Second file",
      metadata: {},
    })
    expect(store.getLatestByType("github_file")?.title).toBe("file2.go")
  })

  it("returns recent entities by type in reverse order", () => {
    store.register({ type: "github_file", title: "a.go", summary: "A", metadata: {} })
    store.register({ type: "github_file", title: "b.go", summary: "B", metadata: {} })
    store.register({ type: "github_file", title: "c.go", summary: "C", metadata: {} })
    const recent = store.getRecentByType("github_file", 2)
    expect(recent.length).toBe(2)
    expect(recent[0].title).toBe("c.go")
    expect(recent[1].title).toBe("b.go")
  })

  it("updates active context for github_repo", () => {
    store.register({
      type: "github_repo",
      title: "test/repo",
      summary: "A repo",
      metadata: { owner: "test", repo: "repo", fullName: "test/repo", defaultBranch: "main" },
    })
    const ctx = store.getActiveContext()
    expect(ctx.currentRepo?.fullName).toBe("test/repo")
    expect(ctx.currentBranch).toBe("main")
  })

  it("updates active context for uploaded_file", () => {
    store.register({
      type: "uploaded_file",
      title: "report.pdf",
      summary: "Uploaded report",
      metadata: { mimeType: "application/pdf", filename: "report.pdf" },
    })
    const ctx = store.getActiveContext()
    expect(ctx.currentUploadedFile?.filename).toBe("report.pdf")
  })

  it("searches entities by title", () => {
    store.register({ type: "github_file", title: "main.go", summary: "Main file", metadata: {} })
    const found = store.search("main.go")
    expect(found?.title).toBe("main.go")
  })

  it("clears entities by type", () => {
    store.register({ type: "github_file", title: "a.go", summary: "A", metadata: {} })
    store.register({ type: "drive_doc", title: "doc1", summary: "Doc", metadata: {} })
    store.clearByType("github_file")
    expect(store.getLatestByType("github_file")).toBeUndefined()
    expect(store.getLatestByType("drive_doc")).toBeDefined()
  })

  it("clears all entities and context", () => {
    store.register({
      type: "github_repo",
      title: "r",
      summary: "R",
      metadata: { owner: "o", repo: "r", fullName: "o/r" },
    })
    store.clear()
    expect(store.getLatestByType("github_repo")).toBeUndefined()
    expect(store.getActiveContext().currentRepo).toBeUndefined()
  })
})
