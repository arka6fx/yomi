import { describe, expect, it, mock } from "bun:test"

const dueRows = [
  { id: "src-1", userId: "u1", path: "f1", status: "active", syncState: { folderId: "f1", filesIndexed: 0, filesSkipped: 0 } },
]

mock.module("@yomi/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => dueRows }) }) }) },
  ragSources: { sourceType: {}, status: {}, updatedAt: {} },
  ragDocuments: {},
  mcpConnections: {},
}))
mock.module("./index-document.js", () => ({
  indexDocument: async () => ({ status: "indexed" }),
  deleteDocumentByExternalId: async () => false,
}))

const mod = await import("./drive-sync.js")

describe("runDriveSyncSweep", () => {
  it("runs due sources using the injected runner", async () => {
    let synced = 0
    const res = await mod.runDriveSyncSweep(async () => {
      synced++
      return { status: "active", indexed: 0, removed: 0 }
    })
    expect(res.ran).toBe(1)
    expect(synced).toBe(1)
  })

  it("continues past a failing source without throwing", async () => {
    const res = await mod.runDriveSyncSweep(async () => {
      throw new Error("boom")
    })
    expect(res.ran).toBe(0)
  })
})
