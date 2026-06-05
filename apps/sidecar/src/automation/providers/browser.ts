import { getMcpTools, closeMcp } from "../../mcp/client.js"
import type { Provider, ProviderHealth } from "./types.js"

// Slice of the MCP browser client the provider depends on (injectable for tests).
export interface BrowserPort {
  getTools(): Promise<Record<string, unknown>>
  reset(): Promise<void>
}

const defaultPort: BrowserPort = { getTools: getMcpTools, reset: closeMcp }

// BrowserAutomationProvider: Playwright MCP. Healthy when the MCP server yields tools. repair tears
// the client down (closeMcp) and reconnects on the next getTools — recovers a wedged browser child.
export function createBrowserProvider(port: BrowserPort = defaultPort): Provider {
  async function probe(): Promise<ProviderHealth> {
    try {
      const tools = await port.getTools()
      const count = Object.keys(tools).length
      return count > 0
        ? { ok: true, detail: `browser MCP connected (${count} tools)` }
        : { ok: false, detail: "browser MCP unavailable (no tools)" }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "browser MCP error" }
    }
  }
  return {
    id: "browser",
    label: "Browser Automation",
    healthCheck: probe,
    async diagnostics() {
      const tools = await port.getTools().catch(() => ({}) as Record<string, unknown>)
      return { tools: Object.keys(tools), count: Object.keys(tools).length }
    },
    async repair() {
      await port.reset().catch(() => undefined)
      return probe()
    },
  }
}

export const browserProvider = createBrowserProvider()
