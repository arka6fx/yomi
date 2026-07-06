import { describe, expect, it, mock } from "bun:test"

const dueRows = [
  { id: "src-1", userId: "u1", path: "f1", status: "active", syncState: { folderId: "f1", filesIndexed: 0, filesSkipped: 0 } },
]
const updates: any[] = []

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => dueRows }) }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { updates.push(v) } }) }),
  },
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

  it("skips freshly leased sources, runs stale-leased ones, and claims a lease before running", async () => {
    const leased = {
      id: "src-leased",
      userId: "u1",
      path: "f2",
      status: "backfilling",
      syncState: { folderId: "f2", filesIndexed: 0, filesSkipped: 0, syncingAt: new Date().toISOString() },
    }
    const stale = {
      id: "src-stale",
      userId: "u1",
      path: "f3",
      status: "backfilling",
      syncState: { folderId: "f3", filesIndexed: 0, filesSkipped: 0, syncingAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
    }
    dueRows.push(leased, stale)
    updates.length = 0
    try {
      const ranIds: string[] = []
      const res = await mod.runDriveSyncSweep(async (s: any) => {
        ranIds.push(s.id)
        return { status: "active", indexed: 0, removed: 0 }
      })
      expect(ranIds).toEqual(["src-1", "src-stale"])
      expect(res.ran).toBe(2)
      // A lease claim (syncState.syncingAt) is written before each run.
      const leaseWrites = updates.filter((u) => u.syncState?.syncingAt)
      expect(leaseWrites.length).toBe(2)
    } finally {
      dueRows.splice(1)
    }
  })
})
