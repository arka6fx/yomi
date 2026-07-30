import { Hono } from "hono"
import { getAuth } from "../auth.js"
import { handleMcpPost, handleMcpGet, handleMcpDelete } from "../services/mcp-server.js"
import { createPendingAction } from "../services/pending-actions.js"
import type { PendingActionRisk } from "../services/pending-actions.js"
import { EXTERNAL_AGENT_CAPABILITIES } from "@yomi/shared"

export const mcpRouter = new Hono()

mcpRouter.all("*", async (c) => {
  const auth = c.req.header("authorization")
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const session = await getAuth().api.getSession({
    headers: new Headers({ authorization: auth }),
  })
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const userId = session.user.id
  const mcpSessionId = c.req.header("mcp-session-id") ?? null

  const createPendingActionFn = (input: {
    connector: string
    action: string
    risk: PendingActionRisk
    title: string
    preview: string
    payload: unknown
  }) => createPendingAction({ userId, ...input })

  switch (c.req.method) {
    case "POST": {
      const body = await c.req.text()
      const response = await handleMcpPost(
        body,
        mcpSessionId,
        userId,
        createPendingActionFn,
        EXTERNAL_AGENT_CAPABILITIES,
      )
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      })
    }
    case "GET": {
      if (!mcpSessionId) return c.json({ error: "MCP-Session-Id header required" }, 400)
      const response = await handleMcpGet(mcpSessionId, userId)
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      })
    }
    case "DELETE": {
      if (!mcpSessionId) return c.json({ error: "MCP-Session-Id header required" }, 400)
      const response = await handleMcpDelete(mcpSessionId)
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      })
    }
    default:
      return c.json({ error: "Method not allowed" }, 405)
  }
})
