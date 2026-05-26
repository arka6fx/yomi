import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
}

let currentUser: TestUser
let insertValues: unknown[] = []
let updateRows: unknown[] = []
let executeRows: unknown[] = []

const fakeDb = {
  insert: () => ({
    values: (value: unknown) => {
      insertValues.push(value)
      return {
        returning: () => Promise.resolve([{ id: "source_1", ...(value as object) }]),
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([{ id: "document_1" }]),
        }),
        catch: () => Promise.resolve(),
      }
    },
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ id: "source_1" }]),
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
  execute: () => Promise.resolve({ rows: executeRows }),
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  ragChunks: {},
  ragDocuments: {},
  ragEmbeddings: {},
  ragRetrievalLogs: {},
  ragSources: {},
}))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

const { ragRouter } = await import("./rag.js")

function app() {
  const hono = new Hono()
  hono.route("/api/rag", ragRouter)
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

describe("Cloud RAG routes", () => {
  beforeEach(() => {
    currentUser = user()
    insertValues = []
    updateRows = [{ id: "source_1" }]
    executeRows = []
    process.env["OPENAI_API_KEY"] = "test-key"
  })

  it("blocks Explore users from creating sources", async () => {
    currentUser = user({ plan: "explore", subscriptionStatus: "inactive" })

    const res = await app().request("/api/rag/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "notes.md" }),
    })
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(403)
    expect(body.code).toBe("upgrade_required")
    expect(insertValues).toHaveLength(0)
  })

  it("requires a non-empty source name", async () => {
    const res = await app().request("/api/rag/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    })
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_name")
    expect(insertValues).toHaveLength(0)
  })

  it("creates a Pro source", async () => {
    const res = await app().request("/api/rag/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "notes.md", sourceType: "upload" }),
    })
    const body = await res.json() as { userId?: string; name?: string; sourceType?: string }

    expect(res.status).toBe(200)
    expect(body.userId).toBe("user_1")
    expect(body.name).toBe("notes.md")
    expect(body.sourceType).toBe("upload")
  })

  it("requires document content before indexing", async () => {
    const res = await app().request("/api/rag/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "source_1", content: "" }),
    })
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_content")
  })

  it("requires a search query", async () => {
    const res = await app().request("/api/rag/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "  " }),
    })
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_query")
  })

  it("soft-deletes a source owned by the current user", async () => {
    const res = await app().request("/api/rag/sources/source_1", { method: "DELETE" })
    const body = await res.json() as { ok?: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it("returns not found when deleting an unknown source", async () => {
    updateRows = []

    const res = await app().request("/api/rag/sources/missing", { method: "DELETE" })
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(404)
    expect(body.code).toBe("source_not_found")
  })
})
