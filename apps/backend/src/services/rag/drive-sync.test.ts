import { describe, expect, it, mock, beforeEach } from "bun:test"

const state: { sources: any[]; indexed: string[]; deleted: string[] } = {
  sources: [],
  indexed: [],
  deleted: [],
}

mock.module("@yomi/db", () => {
  const db = {
    update: () => ({ set: (v: any) => ({ where: () => { Object.assign(state.sources[0], v); return Promise.resolve() } }) }),
    select: () => ({
      from: () => ({
        where: () => {
          // Awaitable directly (loadKnownExternalIds does `.where()` with no `.limit()`),
          // but also chainable via `.limit()` for callers that do (unused here since
          // index-document.js is mocked out in this test).
          const p: any = Promise.resolve([])
          p.limit = () => Promise.resolve([])
          return p
        },
      }),
    }),
    insert: () => ({ values: (v: any) => ({ returning: () => { const row = { id: "src-1", ...v }; state.sources.push(row); return Promise.resolve([row]) } }) }),
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

beforeEach(() => { state.sources = []; state.indexed = []; state.deleted = [] })

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
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "active", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 0, filesSkipped: 0 } }
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
  })
})
