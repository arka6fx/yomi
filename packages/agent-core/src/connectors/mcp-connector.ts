import { experimental_createMCPClient as createMCPClient, type ToolSet } from "ai"

export interface MCPServerConfig {
  id: string
  url: string
}

export interface MCPAuthProvider {
  getHeaders(userId: string): Promise<Record<string, string>>
  onUnauthorized?(userId: string): Promise<Record<string, string>>
}

export interface MCPToolProvider {
  loadTools(params: {
    userId: string
    servers: MCPServerConfig[]
    authProvider: MCPAuthProvider
  }): Promise<ToolSet>
  close(): Promise<void>
}

export interface MCPToolProviderFactory {
  (): MCPToolProvider
}

export function createMCPToolProvider(): MCPToolProvider {
  const clients = new Map<string, Awaited<ReturnType<typeof createMCPClient>>>()

  async function connectServer(
    server: MCPServerConfig,
    userId: string,
    authProvider: MCPAuthProvider,
  ): Promise<ToolSet> {
    const headers = await authProvider.getHeaders(userId)
    const client = await createMCPClient({
      transport: { type: "sse", url: server.url, headers },
    })
    await client.init()
    clients.set(server.id, client)
    return client.tools()
  }

  async function tryConnectServer(
    server: MCPServerConfig,
    userId: string,
    authProvider: MCPAuthProvider,
    errors: string[],
  ): Promise<ToolSet> {
    const acquiredTools: ToolSet = {}
    try {
      const tools = await connectServer(server, userId, authProvider)
      Object.assign(acquiredTools, tools)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const is401 = /\b401\b|unauthorized/i.test(msg)

      if (is401 && authProvider.onUnauthorized) {
        try {
          const tools = await connectServer(server, userId, authProvider)
          Object.assign(acquiredTools, tools)
          return acquiredTools
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
          errors.push(`${server.id} (${server.url}): ${retryMsg}`)
          return acquiredTools
        }
      }

      errors.push(`${server.id} (${server.url}): ${msg}`)
    }
    return acquiredTools
  }

  return {
    async loadTools({ userId, servers, authProvider }) {
      const allTools: ToolSet = {}
      const errors: string[] = []

      for (const server of servers) {
        if (clients.has(server.id)) continue
        const tools = await tryConnectServer(server, userId, authProvider, errors)
        Object.assign(allTools, tools)
      }

      if (errors.length > 0 && Object.keys(allTools).length === 0) {
        throw new Error(`MCP connection failed: ${errors.join("; ")}`)
      }

      return allTools
    },

    async close() {
      for (const [id, client] of clients) {
        await client.close().catch(() => { /* ignore */ })
        clients.delete(id)
      }
    },
  }
}
