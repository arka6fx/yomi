import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"

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
          return connectorError(err)
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
          return connectorError(err)
        }
      },
    }),

    "notion.createPage": tool({
      description:
        "Create a new page in a Notion database or as a child of an existing page.",
      parameters: z.object({
        parentType: z.enum(["database", "page"]).describe("Whether the parent is a database or a page"),
        parentId: z.string().describe("ID of the parent database or page"),
        title: z.string().describe("Title of the new page"),
        properties: z
          .record(z.string())
          .optional()
          .describe("Additional property values as {propertyName: stringValue} — for database pages only"),
        content: z.string().optional().describe("Optional plain-text content to add as a paragraph block"),
      }),
      execute: async ({ parentType, parentId, title, properties, content }) => {
        try {
          const parent =
            parentType === "database"
              ? { database_id: parentId }
              : { page_id: parentId }

          const props: Record<string, unknown> = {
            title: { title: [{ text: { content: title } }] },
          }
          if (properties && parentType === "database") {
            for (const [key, value] of Object.entries(properties)) {
              props[key] = { rich_text: [{ text: { content: value } }] }
            }
          }

          const body: Record<string, unknown> = { parent, properties: props }
          if (content) {
            body.children = [
              {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: [{ type: "text", text: { content } }] },
              },
            ]
          }

          const page = await notion<{ id: string; url: string }>("/pages", {
            method: "POST",
            body: JSON.stringify(body),
          })
          return { id: page.id, url: page.url, title }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion.updatePage": tool({
      description: "Update properties or content of an existing Notion page.",
      parameters: z.object({
        pageId: z.string().describe("Notion page ID to update"),
        title: z.string().optional().describe("New title for the page"),
        properties: z
          .record(z.string())
          .optional()
          .describe("Property values to update as {propertyName: stringValue}"),
        archived: z.boolean().optional().describe("Set to true to archive (trash) the page"),
      }),
      execute: async ({ pageId, title, properties, archived }) => {
        try {
          const props: Record<string, unknown> = {}
          if (title) props.title = { title: [{ text: { content: title } }] }
          if (properties) {
            for (const [key, value] of Object.entries(properties)) {
              props[key] = { rich_text: [{ text: { content: value } }] }
            }
          }

          const body: Record<string, unknown> = {}
          if (Object.keys(props).length > 0) body.properties = props
          if (archived !== undefined) body.archived = archived

          const page = await notion<{ id: string; url: string }>(`/pages/${pageId}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
          return { id: page.id, url: page.url, updated: true }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion.createDatabaseEntry": tool({
      description:
        "Create a new row (entry) in a Notion database with specified property values.",
      parameters: z.object({
        databaseId: z.string().describe("Notion database ID"),
        title: z.string().describe("Value for the title (Name) property"),
        properties: z
          .record(z.string())
          .optional()
          .describe("Additional property values as {propertyName: stringValue}"),
      }),
      execute: async ({ databaseId, title, properties }) => {
        try {
          const props: Record<string, unknown> = {
            Name: { title: [{ text: { content: title } }] },
          }
          if (properties) {
            for (const [key, value] of Object.entries(properties)) {
              props[key] = { rich_text: [{ text: { content: value } }] }
            }
          }

          const entry = await notion<{ id: string; url: string }>("/pages", {
            method: "POST",
            body: JSON.stringify({ parent: { database_id: databaseId }, properties: props }),
          })
          return { id: entry.id, url: entry.url, title }
        } catch (err) {
          return connectorError(err)
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
          return connectorError(err)
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
  description: "Search, read, create, and update pages and database entries in your Notion workspace.",
  readOnlyByDefault: false,
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
      "Under Capabilities: enable Read content, Insert content, and Update content",
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
