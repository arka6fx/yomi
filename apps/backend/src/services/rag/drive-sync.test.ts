import { describe, expect, it, mock, beforeEach } from "bun:test"

const state: {
  sources: any[]
  indexed: string[]
  deleted: string[]
  deletedDocSourceIds: string[]
  knownDocs: any[]
} = {
  sources: [],
  indexed: [],
  deleted: [],
  deletedDocSourceIds: [],
  knownDocs: [],
}

mock.module("@yomi/db", () => {
  const db = {
    update: () => ({
      set: (v: any) => ({
        where: () => {
          const applied = (async () => {
            for (const row of state.sources) Object.assign(row, v)
          })()
          // purgeDriveSources chains `.returning()` after `.where()`; other callers
          // (setSource) just await the where() promise directly — support both.
          ;(applied as any).returning = (_sel?: any) =>
            Promise.resolve(state.sources.map((r) => ({ id: r.id })))
          return applied
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => {
          // Awaitable directly (loadKnownExternalIds does `.where()` with no `.limit()`),
          // but also chainable via `.limit()` for callers that do (unused here since
          // index-document.js is mocked out in this test). Resolves state.knownDocs so
          // tests can seed already-indexed externalIds.
          const p: any = Promise.resolve(state.knownDocs)
          p.limit = () => Promise.resolve(state.knownDocs)
          return p
        },
      }),
    }),
    insert: () => ({ values: (v: any) => ({ returning: () => { const row = { id: "src-1", ...v }; state.sources.push(row); return Promise.resolve([row]) } }) }),
    delete: () => ({
      where: () => {
        // purgeDriveSources deletes ragDocuments scoped to a source id; the mock
        // can't inspect the eq() predicate, so it just records that a delete ran.
        state.deletedDocSourceIds.push("called")
        return Promise.resolve()
      },
    }),
  }
  // mcpConnections is unused by drive-sync itself, but drive-client.js's realDriveClient
  // default parameter transitively imports integration-tokens.js, which imports mcpConnections
  // from @yomi/db — the mock must still provide the named export so that import resolves.
  return { db, ragSources: {}, ragDocuments: {}, mcpConnections: {} }
})
mock.module("./index-document.js", () => ({
  indexDocument: async (i: any) => { state.indexed.push(i.externalId); return { status: "indexed", documentId: "d" } },
  deleteDocumentByExternalId: async (_u: string, _s: string, e: string) => { state.deleted.push(e); return true },
}))

const { createDriveSource, syncSource, MAX_BACKFILL_FILES_PER_TICK } = await import("./drive-sync.js")

function client(overrides: any = {}) {
  return {
    getStartPageToken: async () => "ptok-0",
    listFolderChildren: async () => ({ files: [{ id: "f1", name: "A", mimeType: "text/plain" }] }),
    fetchContent: async () => "body",
    listChanges: async () => ({ changes: [], newStartPageToken: "ptok-1" }),
    ...overrides,
  }
}

beforeEach(() => { state.sources = []; state.indexed = []; state.deleted = []; state.deletedDocSourceIds = []; state.knownDocs = [] })

describe("drive-sync", () => {
  it("captures a start page token when creating a source", async () => {
    await createDriveSource("u1", "folder-1", "My Folder", client() as any)
    expect(state.sources[0].syncState.drivePageToken).toBe("ptok-0")
    expect(state.sources[0].status).toBe("backfilling")
  })

  it("backfill indexes children then flips to active", async () => {
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "backfilling", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 0, filesSkipped: 0 } }
    state.sources.push(src)
    const res = await syncSource(src as any, client() as any)
    expect(state.indexed).toContain("f1")
    expect(res.status).toBe("active")
  })

  it("incremental deletes trashed files in scope", async () => {
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "active", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 1, filesSkipped: 0 } }
    state.sources.push(src)
    const c = client({ listChanges: async () => ({ changes: [{ fileId: "f1", removed: true }], newStartPageToken: "ptok-2" }) })
    await syncSource(src as any, c as any)
    expect(state.deleted).toContain("f1")
  })

  it("marks needs_reconnect on 401", async () => {
    const { DriveApiError } = await import("./drive-client.js")
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "active", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 0, filesSkipped: 0 } }
    state.sources.push(src)
    const c = client({ listChanges: async () => { throw new DriveApiError("unauthorized", 401) } })
    const res = await syncSource(src as any, c as any)
    expect(res.status).toBe("needs_reconnect")
  })

  it("backfill batches across ticks without dropping files", async () => {
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "backfilling", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", backfillCursor: null, filesIndexed: 0, filesSkipped: 0 } }
    state.sources.push(src)
    let call = 0
    const c = client({
      listFolderChildren: async (_u: string, _f: string, cursor?: string, pageSize?: number) => {
        call++
        if (call === 1) {
          expect(cursor).toBeUndefined()
          expect(pageSize).toBe(MAX_BACKFILL_FILES_PER_TICK)
          return {
            files: [
              { id: "f1", name: "A", mimeType: "text/plain" },
              { id: "f2", name: "B", mimeType: "text/plain" },
            ],
            nextPageToken: "cursor-2",
          }
        }
        expect(cursor).toBe("cursor-2")
        expect(pageSize).toBe(MAX_BACKFILL_FILES_PER_TICK)
        return { files: [{ id: "f3", name: "C", mimeType: "text/plain" }] }
      },
    })

    const res1 = await syncSource(src as any, c as any)
    expect(res1.status).toBe("backfilling")
    expect(state.sources[0].status).toBe("backfilling")
    expect(state.sources[0].syncState.backfillCursor).toBe("cursor-2")

    const res2 = await syncSource(state.sources[0] as any, c as any)
    expect(res2.status).toBe("active")
    expect(state.sources[0].status).toBe("active")

    expect(state.indexed).toEqual(["f1", "f2", "f3"])
  })

  it("incremental indexes changed files in scope and skips out-of-scope ones", async () => {
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "active", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 0, filesSkipped: 0 } }
    state.sources.push(src)
    const c = client({
      listChanges: async () => ({
        changes: [
          {
            fileId: "in-scope",
            removed: false,
            file: { id: "in-scope", name: "InScope", mimeType: "text/plain", parents: ["folder-1"] },
          },
          {
            fileId: "out-of-scope",
            removed: false,
            file: { id: "out-of-scope", name: "OutOfScope", mimeType: "text/plain", parents: ["other-folder"] },
          },
        ],
        newStartPageToken: "ptok-2",
      }),
    })
    await syncSource(src as any, c as any)
    expect(state.indexed).toContain("in-scope")
    expect(state.indexed).not.toContain("out-of-scope")
  })

  it("re-captures a fresh start page token and backfills on 410", async () => {
    const { DriveApiError } = await import("./drive-client.js")
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "active", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 5, filesSkipped: 3 } }
    state.sources.push(src)
    let startTokenCalls = 0
    const c = client({
      getStartPageToken: async () => { startTokenCalls++; return "ptok-fresh" },
      listChanges: async () => { throw new DriveApiError("gone", 410) },
    })
    const res = await syncSource(src as any, c as any)
    expect(res.status).toBe("backfilling")
    expect(startTokenCalls).toBe(1)
    expect(state.sources[0].status).toBe("backfilling")
    expect(state.sources[0].syncState.drivePageToken).toBe("ptok-fresh")
    expect(state.sources[0].syncState.backfillCursor).toBeNull()
    // Counters reset so a re-backfill after token expiry doesn't inherit stale progress.
    expect(state.sources[0].syncState.filesIndexed).toBe(0)
    expect(state.sources[0].syncState.filesSkipped).toBe(0)
  })

  it("isolates a per-file failure during backfill: other files still index, filesSkipped increments, status still progresses", async () => {
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "backfilling", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", backfillCursor: null, filesIndexed: 0, filesSkipped: 0 } }
    state.sources.push(src)
    const c = client({
      listFolderChildren: async () => ({
        files: [
          { id: "f1", name: "A", mimeType: "text/plain" },
          { id: "bad", name: "Bad", mimeType: "text/plain" },
          { id: "f3", name: "C", mimeType: "text/plain" },
        ],
      }),
      fetchContent: async (_u: string, fileId: string) => {
        if (fileId === "bad") throw new Error("boom")
        return "body"
      },
    })
    const res = await syncSource(src as any, c as any)
    expect(state.indexed).toEqual(["f1", "f3"])
    expect(res.status).toBe("active")
    expect(state.sources[0].status).toBe("active")
    expect(state.sources[0].syncState.filesSkipped).toBe(1)
    expect(state.sources[0].syncState.filesIndexed).toBe(2)
  })

  it("lets a per-file 401/403 propagate to needs_reconnect instead of being swallowed", async () => {
    const { DriveApiError } = await import("./drive-client.js")
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "backfilling", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", backfillCursor: null, filesIndexed: 0, filesSkipped: 0 } }
    state.sources.push(src)
    const c = client({
      listFolderChildren: async () => ({
        files: [
          { id: "f1", name: "A", mimeType: "text/plain" },
          { id: "forbidden", name: "Forbidden", mimeType: "text/plain" },
        ],
      }),
      fetchContent: async (_u: string, fileId: string) => {
        if (fileId === "forbidden") throw new DriveApiError("forbidden", 403)
        return "body"
      },
    })
    const res = await syncSource(src as any, c as any)
    expect(res.status).toBe("needs_reconnect")
    expect(state.sources[0].status).toBe("needs_reconnect")
  })

  it("stops backfill at the per-source file cap and marks the source capped + active", async () => {
    const realCap = process.env["DRIVE_MAX_FILES_PER_SOURCE"]
    process.env["DRIVE_MAX_FILES_PER_SOURCE"] = "2"
    try {
      const src = { id: "src-1", userId: "u1", path: "folder-1", status: "backfilling", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", backfillCursor: null, filesIndexed: 0, filesSkipped: 0 } }
      state.sources.push(src)
      const c = client({
        listFolderChildren: async () => ({
          files: [
            { id: "f1", name: "A", mimeType: "text/plain" },
            { id: "f2", name: "B", mimeType: "text/plain" },
            { id: "f3", name: "C", mimeType: "text/plain" },
          ],
          nextPageToken: "cursor-2",
        }),
      })
      const res = await syncSource(src as any, c as any)
      expect(state.indexed).toEqual(["f1", "f2"])
      expect(res.status).toBe("active")
      expect(state.sources[0].status).toBe("active")
      expect(state.sources[0].syncState.capped).toBe(true)
      expect(state.sources[0].syncState.backfillCursor).toBeNull()
    } finally {
      if (realCap === undefined) delete process.env["DRIVE_MAX_FILES_PER_SOURCE"]
      else process.env["DRIVE_MAX_FILES_PER_SOURCE"] = realCap
    }
  })

  it("caps newly indexed files in incremental sync but still updates known files", async () => {
    const realCap = process.env["DRIVE_MAX_FILES_PER_SOURCE"]
    process.env["DRIVE_MAX_FILES_PER_SOURCE"] = "1"
    try {
      state.knownDocs = [{ externalId: "known-file" }]
      const src = { id: "src-1", userId: "u1", path: "folder-1", status: "active", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 1, filesSkipped: 0 } }
      state.sources.push(src)
      const c = client({
        listChanges: async () => ({
          changes: [
            { fileId: "new-file", removed: false, file: { id: "new-file", name: "N", mimeType: "text/plain", parents: ["folder-1"] } },
            { fileId: "known-file", removed: false, file: { id: "known-file", name: "K", mimeType: "text/plain", parents: ["folder-1"] } },
          ],
          newStartPageToken: "ptok-2",
        }),
      })
      await syncSource(src as any, c as any)
      expect(state.indexed).not.toContain("new-file")
      expect(state.indexed).toContain("known-file")
      expect(state.sources[0].syncState.filesSkipped).toBe(1)
    } finally {
      if (realCap === undefined) delete process.env["DRIVE_MAX_FILES_PER_SOURCE"]
      else process.env["DRIVE_MAX_FILES_PER_SOURCE"] = realCap
    }
  })

  it("purgeDriveSources soft-deletes the user's Drive sources and deletes their documents", async () => {
    const { purgeDriveSources } = await import("./drive-sync.js")
    state.sources.push({ id: "src-1", userId: "u1", status: "active" })
    const count = await purgeDriveSources("u1")
    expect(count).toBe(1)
    expect(state.sources[0].status).toBe("deleted")
    expect(state.deletedDocSourceIds).toHaveLength(1)
  })
})
