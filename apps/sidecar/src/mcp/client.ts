import { experimental_createMCPClient } from "ai"
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio"
import { homedir } from "os"
import path from "path"

// Generic MCP client for the agent harness (Spec 17). Today it wires the Playwright browser MCP
// server; the same pattern will host the planned calendar/email/Slack servers. The server process is
// spawned lazily on first use and its tools are merged into the agent tool set. If it can't start
// (offline, missing browser), the agent degrades gracefully — browser tools are simply absent.

type McpToolSet = Record<string, unknown>
type McpClient = Awaited<ReturnType<typeof experimental_createMCPClient>>

let client: McpClient | null = null
let toolsCache: McpToolSet | null = null
let connecting: Promise<McpToolSet> | null = null

// Persistent browser profile so logins/cookies survive across runs (lives alongside the notepad).
function browserProfileDir(): string {
  return path.join(homedir(), ".yomi", "browser-profile")
}

// How to launch the Playwright MCP server. Default: run the locally-installed `playwright-mcp` bin via
// `bun x` (uses the running bun binary, so no PATH/node dependency). Override with
// YOMI_MCP_PLAYWRIGHT_CMD (e.g. "npx -y @playwright/mcp") — useful for the packaged app.
function playwrightCommand(): { command: string; args: string[] } {
  const profile = browserProfileDir()
  const baseArgs = ["--browser", "chromium", "--user-data-dir", profile]
  const override = process.env.YOMI_MCP_PLAYWRIGHT_CMD
  if (override) {
    const [command, ...args] = override.split(/\s+/).filter(Boolean)
    return { command: command!, args: [...args, ...baseArgs] }
  }
  return { command: process.execPath, args: ["x", "playwright-mcp", ...baseArgs] }
}

async function connect(): Promise<McpToolSet> {
  const { command, args } = playwrightCommand()
  client = await experimental_createMCPClient({
    transport: new Experimental_StdioMCPTransport({ command, args }),
  })
  toolsCache = (await client.tools()) as McpToolSet
  console.warn(`[yomi/mcp] browser MCP connected (${Object.keys(toolsCache).length} tools)`)
  return toolsCache
}

// Returns the MCP tool set, connecting once and caching. On failure, caches an empty set so we don't
// pay the spawn cost on every agent turn (a sidecar restart clears it).
export async function getMcpTools(): Promise<McpToolSet> {
  if (toolsCache) return toolsCache
  if (!connecting) {
    connecting = connect()
      .catch((err) => {
        console.warn("[yomi/mcp] browser MCP unavailable:", err instanceof Error ? err.message : err)
        toolsCache = {}
        return {}
      })
      .finally(() => { connecting = null })
  }
  return connecting
}

// Close the MCP client and its child browser. Called on sidecar shutdown.
export async function closeMcp(): Promise<void> {
  try { await client?.close() } catch { /* already gone */ }
  client = null
  toolsCache = null
}
