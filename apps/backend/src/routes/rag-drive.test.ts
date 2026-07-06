import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

const mockRagSources = {}

type TestUser = {
  id: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
}

let currentUser: TestUser
let updateRows: unknown[] = []
let sourceRows: unknown[] = [{ id: "src-1", userId: "user_1", path: "folder-1", status: "active", syncState: null }]

const fakeDb = {
  insert: () => ({
    values: () => ({
      returning: () => Promise.resolve([]),
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(sourceRows),
      }),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve(updateRows),
      }),
    }),
  }),
  delete: () => ({
    where: () => Promise.resolve(),
  }),
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  ragSources: mockRagSources,
}))

mock.module("../middleware/consent.js", () => ({
  requireConsent: () => async (_c: any, next: () => Promise<void>) => {
    await next()
  },
}))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("../services/rag/drive-sync.js", () => ({
  DRIVE_SOURCE_TYPE: "google-drive",
  createDriveSource: async () => ({ id: "src-1" }),
  syncSource: async () => ({ status: "active", indexed: 2, removed: 0 }),
}))

let ragDriveRouter: import("hono").Hono

beforeAll(async () => {
  ragDriveRouter = (await import("./rag-drive.js")).ragDriveRouter
})

function app() {
  const hono = new Hono()
  hono.route("/api/rag/drive", ragDriveRouter)
  return hono
}

function user(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "user_1",
    email: "user@example.com",
    role: "user",
    plan: "pro",
    subscriptionStatus: "active",
    ...overrides,
  }
}

describe("Drive-sync source routes", () => {
  beforeEach(() => {
    currentUser = user()
    updateRows = [{ id: "src-1" }]
    sourceRows = [
      { id: "src-1", userId: "user_1", path: "folder-1", status: "active", syncState: null },
    ]
  })

  afterEach(() => {
    // no-op
  })

  it("creates a source when a folderId is provided", async () => {
    const res = await app().request("/api/rag/drive/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: "folder-1", name: "My Folder" }),
    })
    const body = (await res.json()) as { id?: string }

    expect(res.status).toBe(200)
    expect(body.id).toBe("src-1")
  })

  it("rejects source creation without a folderId", async () => {
    const res = await app().request("/api/rag/drive/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Folder" }),
    })
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_folder")
  })

  it("syncs a source and returns the sync result", async () => {
    const res = await app().request("/api/rag/drive/sources/src-1/sync", {
      method: "POST",
    })
    const body = (await res.json()) as { status?: string; indexed?: number; removed?: number }

    expect(res.status).toBe(200)
    expect(body).toEqual({ status: "active", indexed: 2, removed: 0 })
  })

  it("deletes a source and returns ok when source exists", async () => {
    updateRows = [{ id: "src-1" }]
    const res = await app().request("/api/rag/drive/sources/src-1", {
      method: "DELETE",
    })
    const body = (await res.json()) as { ok?: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it("returns 404 when deleting a non-existent source", async () => {
    updateRows = []
    const res = await app().request("/api/rag/drive/sources/nonexistent", {
      method: "DELETE",
    })
    const body = (await res.json()) as { error?: string; code?: string }

    expect(res.status).toBe(404)
    expect(body.code).toBe("source_not_found")
  })
})
