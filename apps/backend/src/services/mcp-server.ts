import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

interface McpSession {
  transport: StreamableHTTPServerTransport
  userId: string
  createdAt: number
}

const sessions = new Map<string, McpSession>()

const SESSION_TTL_MS = 30 * 60 * 1000

function reapStaleSessions(): void {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      s.transport.close().catch(() => {})
      sessions.delete(id)
    }
  }
}

function createServer(): Server {
  const server = new Server(
    { name: "yomi", version: "0.1.0" },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [],
  }))

  return server
}

export async function handleMcpPost(
  body: string | null,
  mcpSessionId: string | null,
  userId: string,
): Promise<Response> {
  reapStaleSessions()

  let session = mcpSessionId ? sessions.get(mcpSessionId) : undefined

  if (!session) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    })
    const server = createServer()
    await server.connect(transport)
    session = { transport, userId, createdAt: Date.now() }

    transport.onclose = () => {
      if (mcpSessionId) sessions.delete(mcpSessionId)
    }
  }

  const req = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(mcpSessionId ? { "MCP-Session-Id": mcpSessionId } : {}),
    },
    body,
  })

  const wt = (session.transport as unknown as { _webStandardTransport: { handleRequest: (req: Request) => Promise<Response> } })._webStandardTransport
  const response = await wt.handleRequest(req)

  const newSessionId = response.headers.get("mcp-session-id")
  if (newSessionId && newSessionId !== mcpSessionId) {
    sessions.set(newSessionId, session)
  }

  return response
}

export async function handleMcpGet(
  mcpSessionId: string,
  _userId: string,
): Promise<Response> {
  const session = sessions.get(mcpSessionId)
  if (!session) return new Response("Session not found", { status: 404 })

  const req = new Request("http://localhost/mcp", {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      "MCP-Session-Id": mcpSessionId,
    },
  })

  const wt = (session.transport as unknown as { _webStandardTransport: { handleRequest: (req: Request) => Promise<Response> } })._webStandardTransport
  return wt.handleRequest(req)
}

export async function handleMcpDelete(mcpSessionId: string): Promise<Response> {
  const session = sessions.get(mcpSessionId)
  if (!session) return new Response("Session not found", { status: 404 })

  const req = new Request("http://localhost/mcp", {
    method: "DELETE",
    headers: {
      "MCP-Session-Id": mcpSessionId,
    },
  })

  const wt = (session.transport as unknown as { _webStandardTransport: { handleRequest: (req: Request) => Promise<Response> } })._webStandardTransport
  const response = await wt.handleRequest(req)
  sessions.delete(mcpSessionId)
  return response
}

export async function getMcpSessionUserId(sessionId: string): Promise<string | null> {
  return sessions.get(sessionId)?.userId ?? null
}
