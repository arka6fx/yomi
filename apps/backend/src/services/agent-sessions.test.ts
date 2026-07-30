import { beforeEach, describe, expect, it, mock } from "bun:test"

let mockSessions: Record<string, unknown>[] = []
let mockMessages: Record<string, unknown>[] = []
let lastUpdate: Record<string, unknown> = {}

function thenable<T>(value: T) {
  const p = Promise.resolve(value)
  return Object.assign(p, {
    orderBy: () => thenable(value),
    limit: (n: number) =>
      Promise.resolve(Array.isArray(value) ? (value as unknown[]).slice(0, n) : value),
  }) as Promise<T> & { orderBy: () => unknown; limit: (n: number) => Promise<unknown> }
}

mock.module("@yomi/db", () => ({
  db: {
    select: (fields: unknown) => ({
      from: () => {
        const isMsgQuery =
          fields && typeof fields === "object" && "role" in (fields as Record<string, unknown>)
        return {
          where: () => thenable(isMsgQuery ? mockMessages : mockSessions),
        }
      },
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "new_session", messageCount: 0 }]),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        lastUpdate = v
        return { where: () => Promise.resolve() }
      },
    }),
    execute: () =>
      Promise.resolve({
        rows: mockSessions.slice(0, 5).map((s) => ({
          id: s.id,
          title: s.title ?? null,
          summary: s.summary ?? null,
          messageCount: s.messageCount ?? 0,
          closedAt: s.closedAt ?? null,
          score: s.score ?? 1,
        })),
      }),
  },
  agentSessions: {},
  agentMessages: {},
}))

mock.module("ai", () => ({
  tool: (def: Record<string, unknown>) => def,
  generateObject: async () => ({
    object: { title: "Test Title", summary: "Test summary content." },
    usage: { promptTokens: 50, completionTokens: 20 },
  }),
  jsonSchema: (s: Record<string, unknown>) => s,
}))

mock.module("@yomi/agent-core", () => ({
  createModel: (modelId: string) => modelId,
  createRecallTool: (search: (...args: unknown[]) => unknown) => search,
}))

const {
  closeAgentSession,
  getOrCreateAgentSession,
  searchSessions,
  summarizeSession,
  summarizeUnsummarizedSessions,
} = await import("./agent-sessions.js")

beforeEach(() => {
  mockSessions = [
    {
      id: "session_1",
      userId: "user_1",
      platform: "telegram",
      chatId: "chat_1",
      title: null,
      summary: null,
      messageCount: 10,
      status: "active",
      closedAt: null,
      score: 0.95,
    },
    {
      id: "session_2",
      userId: "user_1",
      platform: "telegram",
      chatId: "chat_1",
      title: "Old Title",
      summary: "Old summary",
      messageCount: 5,
      status: "closed",
      closedAt: new Date().toISOString(),
      score: 0.8,
    },
  ]
  mockMessages = [
    { sessionId: "session_1", role: "user", content: "hello", createdAt: new Date() },
    { sessionId: "session_1", role: "assistant", content: "hi there", createdAt: new Date() },
  ]
  lastUpdate = {}
})

describe("getOrCreateAgentSession", () => {
  it("returns existing active session", async () => {
    const result = await getOrCreateAgentSession({
      userId: "user_1",
      platform: "telegram",
      chatId: "chat_1",
    })
    expect(result).toBeDefined()
    if (result) expect(result.id).toBe("session_1")
  })
})

describe("closeAgentSession", () => {
  it("closes the active session", async () => {
    mockSessions[0]!.status = "active"
    await closeAgentSession({ userId: "user_1", platform: "telegram", chatId: "chat_1" })
    expect(lastUpdate).toHaveProperty("status", "closed")
  })
})

describe("summarizeSession", () => {
  it("calls generateObject and updates title and summary", async () => {
    await summarizeSession("session_1")
    expect(lastUpdate).toHaveProperty("title", "Test Title")
    expect(lastUpdate).toHaveProperty("summary", "Test summary content.")
  })

  it("skips when no messages exist", async () => {
    mockMessages = []
    await summarizeSession("session_empty")
    expect(Object.keys(lastUpdate).length).toBe(0)
  })
})

describe("summarizeUnsummarizedSessions", () => {
  it("returns a count of summarized sessions", async () => {
    mockSessions = [
      { id: "s1", title: null, status: "closed", closedAt: new Date().toISOString(), score: 1 },
      {
        id: "s2",
        title: "Has Title",
        status: "closed",
        closedAt: new Date().toISOString(),
        score: 1,
      },
    ]
    const count = await summarizeUnsummarizedSessions(10)
    expect(typeof count).toBe("number")
  })
})

describe("searchSessions", () => {
  it("returns results for a valid query", async () => {
    mockSessions = [
      {
        id: "session_1",
        title: "Pricing Discussion",
        summary: "Decided on $19/mo Pro tier",
        messageCount: 12,
        closedAt: new Date().toISOString(),
        score: 0.92,
      },
    ]
    const results = await searchSessions("user_1", "pricing", 5)
    expect(Array.isArray(results)).toBe(true)
  })

  it("returns empty array for empty query", async () => {
    const results = await searchSessions("user_1", "", 5)
    expect(results).toEqual([])
  })
})
