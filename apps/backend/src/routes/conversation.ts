import { Hono } from "hono"
import { authenticate } from "../auth.js"
import { requireConsent } from "../middleware/consent.js"
import {
  appendAgentTurn,
  closeAgentSession,
  getOrCreateAgentSession,
  loadAgentHistory,
} from "../services/agent-sessions.js"

export const conversationRouter = new Hono()

const SHARED_SESSION_PLATFORM = "yomi"
const SHARED_SESSION_CHAT_ID = "global"
const MAX_APPEND_CHARS = 8_000

conversationRouter.get(
  "/shared",
  authenticate,
  requireConsent("conversation_history"),
  async (c) => {
    const user = c.get("user")
    const session = await getOrCreateAgentSession({
      userId: user.id,
      platform: SHARED_SESSION_PLATFORM,
      chatId: SHARED_SESSION_CHAT_ID,
    })
    const history = await loadAgentHistory(session.id)
    return c.json({ history })
  },
)

conversationRouter.post(
  "/shared/turn",
  authenticate,
  requireConsent("conversation_history"),
  async (c) => {
    const user = c.get("user")
    const body = (await c.req.json().catch(() => null)) as {
      userText?: unknown
      assistantText?: unknown
    } | null
    const userText =
      typeof body?.userText === "string" ? body.userText.trim().slice(0, MAX_APPEND_CHARS) : ""
    const assistantText =
      typeof body?.assistantText === "string"
        ? body.assistantText.trim().slice(0, MAX_APPEND_CHARS)
        : ""
    if (!userText || !assistantText)
      return c.json({ error: "userText and assistantText are required" }, 400)

    const session = await getOrCreateAgentSession({
      userId: user.id,
      platform: SHARED_SESSION_PLATFORM,
      chatId: SHARED_SESSION_CHAT_ID,
    })
    await appendAgentTurn({ sessionId: session.id, userId: user.id, userText, assistantText })
    return c.json({ ok: true })
  },
)

conversationRouter.post("/shared/reset", authenticate, async (c) => {
  const user = c.get("user")
  await closeAgentSession({
    userId: user.id,
    platform: SHARED_SESSION_PLATFORM,
    chatId: SHARED_SESSION_CHAT_ID,
  })
  return c.json({ ok: true })
})
