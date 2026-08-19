import { Hono } from "hono"
import { authenticate } from "../auth.js"
import { requireConsent } from "../middleware/consent.js"
import { getSessionDetail, listAgentSessions, searchSessions } from "../services/agent-sessions.js"

export const historyRouter = new Hono()

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

interface HistoryCard {
  id: string
  title: string | null
  summary: string | null
  messageCount: number
  platform: string | null
  lastMessageAt: string | null
  closedAt: string | null
  lastMessage: { role: string; content: string } | null
}

historyRouter.get("/sessions", authenticate, requireConsent("conversation_history"), async (c) => {
  const user = c.get("user")
  const limit = Math.min(Number(c.req.query("limit")) || DEFAULT_LIMIT, MAX_LIMIT)
  const q = (c.req.query("q") ?? "").trim()

  if (q) {
    const results = await searchSessions(user.id, q, limit)
    const sessions: HistoryCard[] = results.map((row) => {
      const latest = row.matchedMessages?.[0] ?? null
      return {
        id: row.sessionId,
        title: row.title,
        summary: row.summary,
        messageCount: row.messageCount,
        platform: null,
        lastMessageAt: latest?.createdAt ?? row.closedAt,
        closedAt: row.closedAt,
        lastMessage: latest ? { role: latest.role, content: latest.contentPreview } : null,
      }
    })
    return c.json({ sessions })
  }

  const cursor = c.req.query("cursor") || null
  const sessions = await listAgentSessions(user.id, { limit, cursor })
  return c.json({ sessions })
})

historyRouter.get(
  "/sessions/:id",
  authenticate,
  requireConsent("conversation_history"),
  async (c) => {
    const user = c.get("user")
    const id = c.req.param("id")
    if (!id) return c.json({ error: "Not found" }, 404)
    const detail = await getSessionDetail(user.id, id)
    if (!detail) return c.json({ error: "Not found" }, 404)
    return c.json(detail)
  },
)
