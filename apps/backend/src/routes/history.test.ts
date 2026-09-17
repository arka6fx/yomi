import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

let mockUser: { id: string } | null = { id: "user_1" }

mock.module("../auth.js", () => ({
  authenticate: async (
    c: { set: (k: string, v: unknown) => void; json: unknown },
    next: () => Promise<void>,
  ) => {
    if (!mockUser)
      return (c as { json: (b: unknown, s: number) => unknown }).json(
        { error: "Unauthorized" },
        401,
      )
    c.set("user", mockUser)
    await next()
  },
}))

mock.module("../services/privacy/checks.js", () => ({
  checkConsent: async () => ({ allowed: true, reason: null, decided: true }),
}))

let listResult: unknown[] = []
let searchResult: unknown[] = []
let detailResult: unknown = null
const listCalls: unknown[] = []
const searchCalls: unknown[] = []
const detailCalls: unknown[] = []

mock.module("../services/agent-sessions.js", () => ({
  listAgentSessions: async (userId: string, opts: unknown) => {
    listCalls.push({ userId, opts })
    return listResult
  },
  searchSessions: async (userId: string, query: string, limit: number) => {
    searchCalls.push({ userId, query, limit })
    return searchResult
  },
  getSessionDetail: async (userId: string, sessionId: string) => {
    detailCalls.push({ userId, sessionId })
    return detailResult
  },
}))

beforeEach(() => {
  mockUser = { id: "user_1" }
  listResult = []
  searchResult = []
  detailResult = null
  listCalls.length = 0
  searchCalls.length = 0
  detailCalls.length = 0
})

async function historyApp() {
  const { historyRouter } = await import("./history.js")
  return new Hono().route("/api/history", historyRouter)
}

describe("GET /api/history/sessions", () => {
  it("rejects an unauthenticated request", async () => {
    mockUser = null
    const app = await historyApp()
    const res = await app.request("/api/history/sessions")
    expect(res.status).toBe(401)
  })

  it("lists sessions for the authenticated user when no query is given", async () => {
    listResult = [
      {
        id: "session_1",
        title: "Connect Notion",
        summary: "Connected Notion.",
        messageCount: 4,
        platform: "telegram",
        lastMessageAt: "2026-08-14T10:00:00.000Z",
        closedAt: "2026-08-14T10:00:05.000Z",
        lastMessage: { role: "assistant", content: "notion's connected now" },
      },
    ]
    const app = await historyApp()
    const res = await app.request("/api/history/sessions")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: unknown[] }
    expect(body.sessions).toEqual(listResult)
    expect(listCalls[0]).toMatchObject({ userId: "user_1" })
  })

  it("searches instead of listing when q is given, normalizing matches to card shape", async () => {
    searchResult = [
      {
        sessionId: "session_2",
        title: "Order chole bhature",
        summary: "Ordered chole bhature.",
        messageCount: 6,
        closedAt: "2026-08-09T12:00:00.000Z",
        relevance: 0.8,
        matchedMessages: [
          {
            role: "assistant",
            contentPreview: "still want me to order chole bhature?",
            createdAt: "2026-08-09T11:59:00.000Z",
          },
        ],
      },
    ]
    const app = await historyApp()
    const res = await app.request("/api/history/sessions?q=chole")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: { id: string; lastMessage: unknown }[] }
    expect(body.sessions).toEqual([
      {
        id: "session_2",
        title: "Order chole bhature",
        summary: "Ordered chole bhature.",
        messageCount: 6,
        platform: null,
        lastMessageAt: "2026-08-09T11:59:00.000Z",
        closedAt: "2026-08-09T12:00:00.000Z",
        lastMessage: { role: "assistant", content: "still want me to order chole bhature?" },
      },
    ])
    expect(searchCalls[0]).toMatchObject({ userId: "user_1", query: "chole" })
  })
})

describe("GET /api/history/sessions/:id", () => {
  it("returns 404 when the session doesn't belong to this user", async () => {
    detailResult = null
    const app = await historyApp()
    const res = await app.request("/api/history/sessions/not_mine")
    expect(res.status).toBe(404)
  })

  it("returns the full transcript when it does", async () => {
    detailResult = {
      id: "session_1",
      title: "Connect Notion",
      summary: "Connected Notion.",
      platform: "telegram",
      closedAt: "2026-08-14T10:00:05.000Z",
      messages: [
        { role: "user", content: "connect notion", createdAt: "2026-08-14T09:59:00.000Z" },
      ],
    }
    const app = await historyApp()
    const res = await app.request("/api/history/sessions/session_1")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(detailResult)
    expect(detailCalls[0]).toEqual({ userId: "user_1", sessionId: "session_1" })
  })
})
