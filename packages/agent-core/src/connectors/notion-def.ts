import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"

export function createNotionTools(ctx: ConnectorContext): ToolSet {
  async function notion<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "notion")
    const base = "https://api.notion.com/v1"
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Notion API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  function extractPlainText(richText: { plain_text: string }[] = []): string {
    return richText.map((r) => r.plain_text).join("")
  }

  return {
    "notion.search": tool({
      description:
        "Search across all Notion pages and databases the user has shared with this integration. Returns matching page titles and URLs.",
      parameters: z.object({
        query: z.string().describe("Search query text"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const data = await notion<{
            results?: {
              id: string
              object: string
              url: string
              properties?: Record<string, { title?: { plain_text: string }[]; type?: string }>
              title?: { plain_text: string }[]
            }[]
          }>("/search", {
            method: "POST",
            body: JSON.stringify({ query, page_size: limit }),
          })
          const results = (data.results ?? []).map((r) => {
            const title =
              r.object === "database"
                ? extractPlainText(r.title)
                : extractPlainText(
                    Object.values(r.properties ?? {}).find((p) => p.title)?.title,
                  )
            return { id: r.id, type: r.object, title: title || "(Untitled)", url: r.url }
          })
          if (results.length === 0) return { results: [], message: "No results found." }
          return { count: results.length, results }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Search failed" }
        }
      },
    }),

    "notion.getPage": tool({
      description: "Get the content of a specific Notion page by its ID.",
      parameters: z.object({
        pageId: z.string().describe("Notion page ID (from search results or URL)"),
      }),
      execute: async ({ pageId }) => {
        try {
          // Fetch page metadata and first block of content
          const page = await notion<{
            id: string
            url: string
            properties?: Record<string, {
              type?: string
              title?: { plain_text: string }[]
              rich_text?: { plain_text: string }[]
            }>
          }>(`/pages/${pageId}`)

          const blocks = await notion<{
            results?: {
              type: string
              [key: string]: unknown
            }[]
          }>(`/blocks/${pageId}/children?page_size=20`)

          const title = extractPlainText(
            Object.values(page.properties ?? {}).find((p) => p.title)?.title,
          )

          const content = (blocks.results ?? [])
            .slice(0, 20)
            .map((b) => {
              const block = b as Record<string, unknown>
              const typed = block[b.type] as { rich_text?: { plain_text: string }[] } | undefined
              return extractPlainText(typed?.rich_text)
            })
            .filter(Boolean)
            .join("\n")

          return { id: page.id, title: title || "(Untitled)", url: page.url, content: content.slice(0, 5000) }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch page" }
        }
      },
    }),

    "notion.queryDatabase": tool({
      description:
        "Query a Notion database to retrieve rows matching optional filters. Returns row titles and key properties.",
      parameters: z.object({
        databaseId: z.string().describe("Notion database ID"),
        filter: z
          .string()
          .optional()
          .describe("Optional text to filter by (applied to title property)"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max rows to return"),
      }),
      execute: async ({ databaseId, filter, limit }) => {
        try {
          const body: Record<string, unknown> = { page_size: limit }
          if (filter) {
            body.filter = {
              property: "Name",
              title: { contains: filter },
            }
          }
          const data = await notion<{
            results?: {
              id: string
              url: string
              properties?: Record<string, {
                type?: string
                title?: { plain_text: string }[]
                rich_text?: { plain_text: string }[]
                select?: { name: string }
                status?: { name: string }
              }>
            }[]
          }>(`/databases/${databaseId}/query`, {
            method: "POST",
            body: JSON.stringify(body),
          })
          const rows = (data.results ?? []).map((r) => {
            const props = r.properties ?? {}
            const title = extractPlainText(
              Object.values(props).find((p) => p.title)?.title,
            )
            const summary = Object.fromEntries(
              Object.entries(props)
                .slice(0, 5)
                .map(([k, v]) => [
                  k,
                  v.title
                    ? extractPlainText(v.title)
                    : v.rich_text
                      ? extractPlainText(v.rich_text)
                      : v.select?.name ?? v.status?.name ?? "",
                ]),
            )
            return { id: r.id, title: title || "(Untitled)", url: r.url, properties: summary }
          })
          if (rows.length === 0) return { rows: [], message: "No rows found." }
          return { count: rows.length, rows }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Query failed" }
        }
      },
    }),
  }
}

export const notionDef: ConnectorDef = {
  id: "notion",
  name: "Notion",
  category: "knowledge",
  icon: "notion",
  description: "Search pages, read content, and query databases in your Notion workspace.",
  readOnlyByDefault: true,
  auth: {
    kind: "oauth2",
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],  // Notion doesn't use scope parameter — public integration only
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/notion",
    // Notion requires HTTP Basic auth (client_id:client_secret) on token endpoint
    tokenRequestAuth: "basic",
  },
  setup: {
    providerConsoleUrl: "https://www.notion.so/my-integrations",
    steps: [
      "Go to notion.so/my-integrations → New integration",
      "Set type to 'Public' (required for OAuth — internal integrations don't support OAuth)",
      "Set Redirect URI to: ${BACKEND_URL}/api/integrations/callback/notion",
      "Under Capabilities: enable Read content",
      "Copy the OAuth client ID and client secret",
    ],
    collect: [
      { env: "NOTION_CLIENT_ID", label: "Notion OAuth Client ID", secret: false },
      { env: "NOTION_CLIENT_SECRET", label: "Notion OAuth Client Secret", secret: true },
    ],
    docsUrl: "https://developers.notion.com/docs/authorization",
  },
  tools: createNotionTools,
}
