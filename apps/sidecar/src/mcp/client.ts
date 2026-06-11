// ── Browser automation — will provide later ─────────────────────────────────
// import { experimental_createMCPClient } from "ai"
// import { Experimental_StdioMCPTransport } from "ai/mcp-stdio"
// import { homedir } from "os"
// import path from "path"
// 
// type McpToolSet = Record<string, unknown>
// type McpClient = Awaited<ReturnType<typeof experimental_createMCPClient>>
// 
// let client: McpClient | null = null
// let toolsCache: McpToolSet | null = null
// let connecting: Promise<McpToolSet> | null = null
// 
// function browserProfileDir(): string {
//   return path.join(homedir(), ".yomi", "browser-profile")
// }
// 
// function playwrightCommand(): { command: string; args: string[] } {
//   const profile = browserProfileDir()
//   const browser = process.env.YOMI_BROWSER_AUTOMATION_BROWSER || "chrome"
//   const baseArgs = ["--browser", browser, "--user-data-dir", profile]
//   const override = process.env.YOMI_MCP_PLAYWRIGHT_CMD
//   if (override) {
//     const [command, ...args] = override.split(/\s+/).filter(Boolean)
//     return { command: command!, args: [...args, ...baseArgs] }
//   }
//   return { command: process.execPath, args: ["x", "playwright-mcp", ...baseArgs] }
// }
// 
// async function connect(): Promise<McpToolSet> {
//   const { command, args } = playwrightCommand()
//   client = await experimental_createMCPClient({
//     transport: new Experimental_StdioMCPTransport({ command, args }),
//   })
//   toolsCache = (await client.tools()) as McpToolSet
//   console.warn(`[yomi/mcp] browser MCP connected (${Object.keys(toolsCache).length} tools)`)
//   return toolsCache
// }
// 
// export async function getMcpTools(): Promise<McpToolSet> {
//   if (toolsCache) return toolsCache
//   if (!connecting) {
//     connecting = connect()
//       .catch((err) => {
//         console.warn("[yomi/mcp] browser MCP unavailable:", err instanceof Error ? err.message : err)
//         toolsCache = {}
//         return {}
//       })
//       .finally(() => { connecting = null })
//   }
//   return connecting
// }
// 
// export async function closeMcp(): Promise<void> {
//   try { await client?.close() } catch { /* already gone */ }
//   client = null
//   toolsCache = null
// }

export async function getMcpTools(): Promise<Record<string, unknown>> {
  return {}
}

export async function closeMcp(): Promise<void> {}
