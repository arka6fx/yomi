import { tool, type ToolSet } from "ai"
import { z } from "zod"
import { connectorError, type ConnectorContext, type ConnectorDef } from "./connector-def.js"

// Context7's Composio toolkit ("context7_mcp") is a raw MCP passthrough that isn't
// indexed in Composio's REST tools/execute catalog (verified: /api/v3/tools returns
// 0 items for it, and every guessed execute slug 404s as Tool_ToolNotFound) — so
// this bypasses Composio entirely and calls Context7's own public REST API
// (https://context7.com/api/v1/*), which mirrors the two tools its MCP server
// exposes (resolve-library-id, get-library-docs; verified directly against
// mcp.context7.com's tools/list). Works without a key at a lower rate limit; a key
// raises it.
const BASE_URL = "https://context7.com/api/v1"

async function context7Fetch(path: string, params: Record<string, string | undefined>, apiKey: string | null) {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v)
  }
  const headers: Record<string, string> = { Accept: "application/json" }
  if (apiKey) headers["X-Context7-API-Key"] = apiKey
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`Context7 ${path} → status ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res
}

async function getApiKey(ctx: ConnectorContext): Promise<string | null> {
  try {
    const key = await ctx.getAccessToken(ctx.userId, "context7")
    return key || null
  } catch {
    return null
  }
}

export function context7Tools(ctx: ConnectorContext): ToolSet {
  return {
    resolveLibraryId: tool({
      description:
        "Resolve a library/package name to a Context7-compatible library ID (e.g. '/vercel/next.js'). " +
        "Call this before queryDocs unless the user already gave an exact '/org/project' ID. Read-only.",
      parameters: z.object({
        libraryName: z.string().describe("Official library name, e.g. 'Next.js', 'Prisma', 'React'"),
      }),
      execute: async ({ libraryName }) => {
        try {
          const apiKey = await getApiKey(ctx)
          const res = await context7Fetch("/search", { query: libraryName }, apiKey)
          const body = (await res.json()) as { results?: unknown[] }
          return { results: (body.results ?? []).slice(0, 10) }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
    queryDocs: tool({
      description:
        "Fetch up-to-date documentation and code examples for a library, scoped to one topic/question. " +
        "Requires an exact Context7 library ID from resolveLibraryId (or given directly by the user). Read-only.",
      parameters: z.object({
        libraryId: z.string().describe("Exact Context7 library ID, e.g. '/vercel/next.js' or '/vercel/next.js/v14.3.0'"),
        topic: z.string().optional().describe("The specific question/topic to fetch docs for"),
        tokens: z.number().int().optional().describe("Max response size in tokens (default ~5000)"),
      }),
      execute: async ({ libraryId, topic, tokens }) => {
        try {
          const apiKey = await getApiKey(ctx)
          const path = libraryId.startsWith("/") ? libraryId : `/${libraryId}`
          const res = await context7Fetch(path, {
            type: "txt",
            topic,
            tokens: tokens ? String(tokens) : undefined,
          }, apiKey)
          return { docs: (await res.text()).slice(0, 20_000) }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
  }
}

export const context7Def: ConnectorDef = {
  id: "context7",
  name: "Context7",
  category: "developer",
  icon: "context7",
  description: "Context7 — up-to-date library documentation for AI coding assistants; resolve library IDs and query API docs/code examples.",
  readOnlyByDefault: true,
  auth: {
    kind: "api_key",
    fields: [
      { name: "CONTEXT7_API_KEY", label: "Context7 API Key", placeholder: "ctx7sk-...", secret: true },
    ],
  },
  setup: {
    providerConsoleUrl: "https://context7.com/dashboard",
    steps: [
      "Get an API key from https://context7.com/dashboard (free tier included; works without a key too, at a lower rate limit)",
      "Paste it in when connecting Context7",
    ],
    collect: [],
    docsUrl: "https://context7.com/docs",
  },
  tools: context7Tools,
}
