import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

const mockRagSources = {}
const mockRagDocuments = {
  userId: {},
  sourceId: {},
  contentHash: {},
}
const mockRagChunks = {}
const mockRagEmbeddings = {}
const mockRagRetrievalLogs = {}

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
let sourceRows: unknown[] = [{ id: "source_1" }]
let documentRows: unknown[] = []
let conflictTargets: unknown[][] = []
let executedQueries: unknown[] = []

// Drizzle's sql`` tagged template returns an SQL object whose queryChunks are
// StringChunk instances (literal text between interpolations) interleaved with
// param nodes. Concatenating the StringChunk values reconstructs the literal
// SQL text (interpolated values are opaque, but the query text around them —
// e.g. a raw `where s.status in (...)` clause — survives intact).
function sqlToString(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? []
  return chunks
    .map((c) => ((c as { value?: string[] })?.value ? (c as { value: string[] }).value.join("") : ""))
    .join("")
}
const realFetch = globalThis.fetch
const realAiCreditsApiKey = process.env["OPENAI_API_KEY"]
const realAiCreditsBaseUrl = process.env["OPENAI_BASE_URL"]
const realAiCreditsEmbeddingModel = process.env["OPENAI_EMBEDDING_MODEL"]

const fakeDb = {
  insert: (table?: unknown) => ({
    values: (value: unknown) => {
      insertValues.push(value)
      return {
        returning: () =>
          Promise.resolve([
            {
              id:
                table === mockRagChunks
                  ? "chunk_1"
                  : table === mockRagDocuments
                    ? "document_1"
                    : "source_1",
              ...(value as object),
            },
          ]),
        onConflictDoUpdate: (config: { target?: unknown[] }) => {
          conflictTargets.push(config.target ?? [])
          return {
            returning: () => Promise.resolve([{ id: "document_1" }]),
          }
        },
        catch: () => Promise.resolve(),
      }
    },
  }),
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: () => Promise.resolve(table === mockRagDocuments ? documentRows : sourceRows),
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
  execute: (query: unknown) => {
    executedQueries.push(query)
    return Promise.resolve({ rows: executeRows })
  },
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  ragChunks: mockRagChunks,
  ragDocuments: mockRagDocuments,
  ragEmbeddings: mockRagEmbeddings,
  ragRetrievalLogs: mockRagRetrievalLogs,
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

let ragRouter: import("hono").Hono

beforeAll(async () => {
  ragRouter = (await import("./rag.js")).ragRouter
})

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
    process.env["OPENAI_API_KEY"] = "test-key"
    process.env["OPENAI_BASE_URL"] = "https://aicredits.test/v1"
    process.env["OPENAI_EMBEDDING_MODEL"] = "text-embedding-3-small"
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const [input] = args
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/embeddings")) {
        const embedding = Array.from({ length: 1536 }, (_, i) => (i % 3) / 10)
        return new Response(JSON.stringify({ data: [{ embedding }] }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    }) as typeof fetch
    currentUser = user()
    insertValues = []
    updateRows = [{ id: "source_1" }]
    executeRows = []
    sourceRows = [{ id: "source_1" }]
    documentRows = []
    conflictTargets = []
    executedQueries = []
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (realAiCreditsApiKey === undefined) delete process.env["OPENAI_API_KEY"]
    else process.env["OPENAI_API_KEY"] = realAiCreditsApiKey
    if (realAiCreditsBaseUrl === undefined) delete process.env["OPENAI_BASE_URL"]
    else process.env["OPENAI_BASE_URL"] = realAiCreditsBaseUrl
    if (realAiCreditsEmbeddingModel === undefined) delete process.env["OPENAI_EMBEDDING_MODEL"]
    else process.env["OPENAI_EMBEDDING_MODEL"] = realAiCreditsEmbeddingModel
  })

  it("blocks Explore users from creating sources", async () => {
    currentUser = user({ plan: "explore", subscriptionStatus: "inactive" })

    const res = await app().request("/api/rag/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "notes.md" }),
    })
    const body = (await res.json()) as { code?: string }

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
    const body = (await res.json()) as { code?: string }

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
    const body = (await res.json()) as { userId?: string; name?: string; sourceType?: string }

    expect(res.status).toBe(200)
    expect(body.userId).toBe("user_1")
    expect(body.name).toBe("notes.md")
    expect(body.sourceType).toBe("upload")
  })

  it("syncs mirrored archive sources", async () => {
    sourceRows = []
    documentRows = []

    const res = await app().request("/api/rag/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sources: [
          {
            path: "sessions/2026-05-26-dev.md",
            title: "2026-05-26-dev.md",
            content: "Mirror this archive note.",
            contentHash: "ignored",
            updatedAt: "2026-05-26T00:00:00.000Z",
          },
        ],
        removedPaths: [],
      }),
    })
    const body = (await res.json()) as { synced?: number; removed?: number }

    expect(res.status).toBe(200)
    expect(body.synced).toBe(1)
    expect(body.removed).toBe(0)
    expect(insertValues.length).toBeGreaterThan(0)
    expect(insertValues[0]).toMatchObject({
      userId: "user_1",
      name: "2026-05-26-dev.md",
      path: "sessions/2026-05-26-dev.md",
      sourceType: "mirror",
    })
  })

  it("requires document content before indexing", async () => {
    const res = await app().request("/api/rag/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "source_1", content: "" }),
    })
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_content")
  })

  it("dedupes manual documents only within the requested source", async () => {
    const res = await app().request("/api/rag/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: "source_1",
        title: "Notes",
        content: "Same content should stay scoped to this source.",
      }),
    })

    expect(res.status).toBe(200)
    expect(conflictTargets[0]).toEqual([mockRagDocuments.sourceId, mockRagDocuments.contentHash])
  })

  it("requires a search query", async () => {
    const res = await app().request("/api/rag/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "  " }),
    })
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_query")
  })

  it("returns hybrid search results with citation markers", async () => {
    executeRows = [
      {
        chunkId: "c1",
        documentId: "d1",
        sourceId: "s1",
        sourceName: "notes.md",
        title: "Notes",
        content: "Alpha content about widgets.",
        score: 0.9,
        embedding: "[0.1,0.2,0.3]",
      },
      {
        chunkId: "c2",
        documentId: "d1",
        sourceId: "s1",
        sourceName: "notes.md",
        title: "Notes",
        content: "Beta content about gadgets.",
        score: 0.5,
        embedding: "[0.9,0.1,0.2]",
      },
    ]

    const res = await app().request("/api/rag/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "widgets" }),
    })
    const body = (await res.json()) as {
      snippets?: { chunkId: string; marker: number; content: string }[]
    }

    expect(res.status).toBe(200)
    expect(body.snippets).toHaveLength(2)
    expect(body.snippets!.map((s) => s.marker)).toEqual([1, 2])
    expect(body.snippets![0]!.content).toContain("widgets")
    // Retrieval is logged with the reranked chunk ids.
    const log = insertValues.find((v) => v && typeof v === "object" && "matchedChunkIds" in v) as
      | { matchedChunkIds: string[] }
      | undefined
    expect(log?.matchedChunkIds).toContain("c1")

    // Drive sources are only ever backfilling/active — never 'ready' — so the
    // search query must include them, or indexed Drive docs are invisible to
    // retrieval. This must FAIL if someone reverts the filter to `= 'ready'`.
    const searchQuery = executedQueries.find((q) =>
      /status in \(.*ready.*active.*backfilling.*\)/i.test(sqlToString(q)),
    )
    expect(searchQuery).toBeDefined()
    expect(sqlToString(searchQuery)).toMatch(/status in \('ready', 'active', 'backfilling'\)/)
  })

  it("soft-deletes a source owned by the current user", async () => {
    const res = await app().request("/api/rag/sources/source_1", { method: "DELETE" })
    const body = (await res.json()) as { ok?: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it("returns not found when deleting an unknown source", async () => {
    updateRows = []

    const res = await app().request("/api/rag/sources/missing", { method: "DELETE" })
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(404)
    expect(body.code).toBe("source_not_found")
  })
})
