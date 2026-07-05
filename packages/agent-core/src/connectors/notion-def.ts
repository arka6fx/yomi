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

  function requireConfirmed(
    confirmed?: boolean,
  ): { error: string; needsConfirmation: true } | null {
    return confirmed === true
      ? null
      : {
          error:
            "Notion write blocked: ask the user to confirm this exact change, then call the tool with confirmed=true.",
          needsConfirmation: true,
        }
  }

  function textBlock(
    type: "paragraph" | "heading_1" | "heading_2" | "bulleted_list_item",
    content: string,
  ): Record<string, unknown> {
    return { object: "block", type, [type]: { rich_text: [{ type: "text", text: { content } }] } }
  }

  function blockToText(block: Record<string, unknown>): string {
    const type = block.type as string
    const data = block[type] as Record<string, unknown> | undefined
    if (!data) return ""

    const rt = (data.rich_text as { plain_text: string }[] | undefined) ?? []
    const text = extractPlainText(rt)

    switch (type) {
      case "paragraph":
        return text
      case "heading_1":
        return `# ${text}`
      case "heading_2":
        return `## ${text}`
      case "heading_3":
        return `### ${text}`
      case "bulleted_list_item":
        return `• ${text}`
      case "numbered_list_item":
        return `1. ${text}`
      case "to_do": {
        const checked = data.checked as boolean | undefined
        return `${checked ? "☑" : "☐"} ${text}`
      }
      case "toggle":
        return `▶ ${text}`
      case "quote":
        return `> ${text}`
      case "callout": {
        const icon = (data.icon as { emoji?: string } | undefined)?.emoji ?? "💡"
        return `${icon} ${text}`
      }
      case "code": {
        const lang = (data.language as string) ?? ""
        return `\`\`\`${lang}\n${text}\n\`\`\``
      }
      case "divider":
        return "---"
      case "child_page":
        return `[Subpage: ${(data.title as string) ?? ""}]`
      case "child_database":
        return `[Database: ${(data.title as string) ?? ""}]`
      case "image":
        return "(Image)"
      case "file":
        return "(File attachment)"
      case "video":
        return "(Video)"
      case "bookmark":
        return `(Bookmark: ${(data.url as string) ?? ""})`
      case "equation":
        return `(Equation: ${(data.expression as string) ?? ""})`
      case "table_of_contents":
        return "(Table of contents)"
      default:
        return text
    }
  }

  async function fetchAllBlocks(blockId: string, maxBlocks = 200, depth = 0): Promise<string> {
    const lines: string[] = []
    let cursor: string | undefined
    while (lines.length < maxBlocks) {
      const qs = new URLSearchParams({ page_size: String(Math.min(100, maxBlocks - lines.length)) })
      if (cursor) qs.set("start_cursor", cursor)
      const data = await notion<{
        results?: (Record<string, unknown> & {
          id?: string
          has_children?: boolean
          type?: string
        })[]
        has_more?: boolean
        next_cursor?: string
      }>(`/blocks/${blockId}/children?${qs}`)

      for (const block of data.results ?? []) {
        const line = blockToText(block)
        if (line) lines.push(line)
        if (block.id && block.has_children && depth < 2 && lines.length < maxBlocks) {
          const childText = await fetchAllBlocks(block.id, maxBlocks - lines.length, depth + 1)
          if (childText) lines.push(childText)
        }
      }
      if (!data.has_more || !data.next_cursor) break
      cursor = data.next_cursor
    }
    return lines.join("\n")
  }

  async function getDatabaseTitleProperty(databaseId: string, fallback = "Name"): Promise<string> {
    const db = await notion<{ properties?: Record<string, { type?: string }> }>(
      `/databases/${databaseId}`,
    )
    return (
      Object.entries(db.properties ?? {}).find(([, prop]) => prop.type === "title")?.[0] ?? fallback
    )
  }

  const NO_ACCESS_HINT =
    "No Notion pages or databases found. Notion only exposes pages you explicitly share with the integration. " +
    "Open Notion, go to each page you want Yomi to access, click ••• → Add connections → select the Yomi integration."

  return {
    "notion-search": tool({
      description:
        "Search across all Notion pages and databases the user has shared with this integration. " +
        "Always returns the direct URL for each result — include it verbatim in your response.",
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
                : extractPlainText(Object.values(r.properties ?? {}).find((p) => p.title)?.title)
            return { id: r.id, type: r.object, title: title || "(Untitled)", url: r.url }
          })
          if (results.length === 0) return { results: [], message: NO_ACCESS_HINT }
          return { count: results.length, results }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion-getPage": tool({
      description:
        "Get the full content of a Notion page by ID. Returns title, direct URL, and all readable text content. " +
        "Use this after notion-search to read the actual page body. Always include the URL in your response.",
      parameters: z.object({
        pageId: z.string().describe("Notion page ID (from search results or URL)"),
      }),
      execute: async ({ pageId }) => {
        try {
          const page = await notion<{
            id: string
            url: string
            properties?: Record<
              string,
              {
                type?: string
                title?: { plain_text: string }[]
                rich_text?: { plain_text: string }[]
                select?: { name: string }
                multi_select?: { name: string }[]
                date?: { start: string; end?: string }
                number?: number
                checkbox?: boolean
                url?: string
              }
            >
          }>(`/pages/${pageId}`)

          const title = extractPlainText(
            Object.values(page.properties ?? {}).find((p) => p.title)?.title,
          )

          // Collect non-title properties as metadata
          const meta: Record<string, string> = {}
          for (const [key, prop] of Object.entries(page.properties ?? {})) {
            if (prop.type === "title") continue
            if (prop.rich_text) meta[key] = extractPlainText(prop.rich_text)
            else if (prop.select) meta[key] = prop.select.name
            else if (prop.multi_select) meta[key] = prop.multi_select.map((s) => s.name).join(", ")
            else if (prop.date)
              meta[key] = prop.date.start + (prop.date.end ? ` → ${prop.date.end}` : "")
            else if (prop.number !== undefined) meta[key] = String(prop.number)
            else if (prop.checkbox !== undefined) meta[key] = prop.checkbox ? "Yes" : "No"
            else if (prop.url) meta[key] = prop.url
          }

          const content = await fetchAllBlocks(pageId)

          return {
            id: page.id,
            title: title || "(Untitled)",
            url: page.url,
            properties: Object.keys(meta).length > 0 ? meta : undefined,
            content: content.slice(0, 10000),
            truncated: content.length > 10000,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion-listPages": tool({
      description:
        "List all Notion pages and databases the user has shared with this integration, without filtering. " +
        "Use when the user wants to see what's available or browse their workspace.",
      parameters: z.object({
        limit: z.number().int().min(1).max(50).default(20).describe("Max pages to return"),
      }),
      execute: async ({ limit }) => {
        try {
          const data = await notion<{
            results?: {
              id: string
              object: string
              url: string
              properties?: Record<string, { title?: { plain_text: string }[]; type?: string }>
              title?: { plain_text: string }[]
              last_edited_time?: string
            }[]
          }>("/search", {
            method: "POST",
            body: JSON.stringify({
              page_size: limit,
              sort: { direction: "descending", timestamp: "last_edited_time" },
            }),
          })
          const results = (data.results ?? []).map((r) => {
            const title =
              r.object === "database"
                ? extractPlainText(r.title)
                : extractPlainText(Object.values(r.properties ?? {}).find((p) => p.title)?.title)
            return {
              id: r.id,
              type: r.object,
              title: title || "(Untitled)",
              url: r.url,
              lastEdited: r.last_edited_time,
            }
          })
          if (results.length === 0) return { results: [], message: NO_ACCESS_HINT }
          return { count: results.length, results }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion-createPage": tool({
      description:
        "Create a new page in a Notion database or as a child of an existing page. Returns the new page URL.",
      parameters: z.object({
        parentType: z
          .enum(["database", "page"])
          .describe("Whether the parent is a database or a page"),
        parentId: z.string().describe("ID of the parent database or page"),
        title: z.string().describe("Title of the new page"),
        properties: z
          .record(z.string())
          .optional()
          .describe(
            "Additional property values as {propertyName: stringValue} — for database pages only",
          ),
        content: z
          .string()
          .optional()
          .describe("Optional plain-text content to add as a paragraph block"),
        titleProperty: z
          .string()
          .optional()
          .describe("Database title property name. If omitted, Yomi discovers it."),
        confirmed: z
          .boolean()
          .optional()
          .describe("Must be true after the user explicitly confirms this write."),
      }),
      execute: async ({
        parentType,
        parentId,
        title,
        properties,
        content,
        titleProperty,
        confirmed,
      }) => {
        try {
          const blocked = requireConfirmed(confirmed)
          if (blocked) return blocked
          const parent =
            parentType === "database" ? { database_id: parentId } : { page_id: parentId }

          const titleKey =
            parentType === "database"
              ? (titleProperty ?? (await getDatabaseTitleProperty(parentId)))
              : "title"
          const props: Record<string, unknown> = {
            [titleKey]: { title: [{ text: { content: title } }] },
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

    "notion-updatePage": tool({
      description: "Update the title, properties, or archived state of an existing Notion page.",
      parameters: z.object({
        pageId: z.string().describe("Notion page ID to update"),
        title: z.string().optional().describe("New title for the page"),
        properties: z
          .record(z.string())
          .optional()
          .describe("Property values to update as {propertyName: stringValue}"),
        archived: z.boolean().optional().describe("Set to true to archive (trash) the page"),
        titleProperty: z
          .string()
          .optional()
          .describe(
            "Title property name for database pages. Defaults to the first title property on the page.",
          ),
        confirmed: z
          .boolean()
          .optional()
          .describe("Must be true after the user explicitly confirms this write."),
      }),
      execute: async ({ pageId, title, properties, archived, titleProperty, confirmed }) => {
        try {
          const blocked = requireConfirmed(confirmed)
          if (blocked) return blocked
          const props: Record<string, unknown> = {}
          if (title) {
            if (titleProperty) {
              props[titleProperty] = { title: [{ text: { content: title } }] }
            } else {
              const page = await notion<{ properties?: Record<string, { type?: string }> }>(
                `/pages/${pageId}`,
              )
              const titleKey =
                Object.entries(page.properties ?? {}).find(
                  ([, prop]) => prop.type === "title",
                )?.[0] ?? "title"
              props[titleKey] = { title: [{ text: { content: title } }] }
            }
          }
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

    "notion-appendContent": tool({
      description: "Append text content (as paragraphs or headings) to an existing Notion page.",
      parameters: z.object({
        pageId: z.string().describe("Notion page ID to append to"),
        content: z
          .string()
          .describe(
            "Text content to append (supports markdown-like: # for h1, ## for h2, • for bullets)",
          ),
        confirmed: z
          .boolean()
          .optional()
          .describe("Must be true after the user explicitly confirms this write."),
      }),
      execute: async ({ pageId, content, confirmed }) => {
        try {
          const blocked = requireConfirmed(confirmed)
          if (blocked) return blocked
          const lines = content.split("\n").filter((l) => l.trim())
          const children = lines.map((line) => {
            if (line.startsWith("# ")) {
              return textBlock("heading_1", line.slice(2))
            }
            if (line.startsWith("## ")) {
              return textBlock("heading_2", line.slice(3))
            }
            if (line.startsWith("• ") || line.startsWith("- ")) {
              return textBlock("bulleted_list_item", line.slice(2))
            }
            return textBlock("paragraph", line)
          })

          await notion<unknown>(`/blocks/${pageId}/children`, {
            method: "PATCH",
            body: JSON.stringify({ children }),
          })
          return { ok: true, blocksAdded: children.length }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion-queryDatabase": tool({
      description:
        "Query a Notion database to retrieve rows matching optional filters. Returns row titles, key properties, and URLs.",
      parameters: z.object({
        databaseId: z.string().describe("Notion database ID"),
        filter: z
          .string()
          .optional()
          .describe("Optional text to filter by (applied to title property)"),
        titleProperty: z
          .string()
          .optional()
          .describe("Database title property name. If omitted, Yomi discovers it."),
        limit: z.number().int().min(1).max(20).default(10).describe("Max rows to return"),
      }),
      execute: async ({ databaseId, filter, titleProperty, limit }) => {
        try {
          const body: Record<string, unknown> = { page_size: limit }
          if (filter) {
            const titleKey = titleProperty ?? (await getDatabaseTitleProperty(databaseId))
            body.filter = {
              property: titleKey,
              title: { contains: filter },
            }
          }
          const data = await notion<{
            results?: {
              id: string
              url: string
              properties?: Record<
                string,
                {
                  type?: string
                  title?: { plain_text: string }[]
                  rich_text?: { plain_text: string }[]
                  select?: { name: string }
                  multi_select?: { name: string }[]
                  status?: { name: string }
                  date?: { start: string }
                  number?: number
                  checkbox?: boolean
                }
              >
            }[]
          }>(`/databases/${databaseId}/query`, {
            method: "POST",
            body: JSON.stringify(body),
          })
          const rows = (data.results ?? []).map((r) => {
            const props = r.properties ?? {}
            const title = extractPlainText(Object.values(props).find((p) => p.title)?.title)
            const summary = Object.fromEntries(
              Object.entries(props)
                .slice(0, 6)
                .map(([k, v]) => [
                  k,
                  v.title
                    ? extractPlainText(v.title)
                    : v.rich_text
                      ? extractPlainText(v.rich_text)
                      : (v.select?.name ??
                        v.status?.name ??
                        (v.multi_select
                          ? v.multi_select.map((s) => s.name).join(", ")
                          : undefined) ??
                        (v.date ? v.date.start : undefined) ??
                        (v.number !== undefined ? String(v.number) : undefined) ??
                        (v.checkbox !== undefined ? (v.checkbox ? "Yes" : "No") : undefined) ??
                        ""),
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

    "notion-createDatabaseEntry": tool({
      description:
        "Create a new row (entry) in a Notion database with specified property values. Returns the new entry URL.",
      parameters: z.object({
        databaseId: z.string().describe("Notion database ID"),
        title: z.string().describe("Value for the title (Name) property"),
        properties: z
          .record(z.string())
          .optional()
          .describe("Additional property values as {propertyName: stringValue}"),
        titleProperty: z
          .string()
          .optional()
          .describe("Database title property name. If omitted, Yomi discovers it."),
        confirmed: z
          .boolean()
          .optional()
          .describe("Must be true after the user explicitly confirms this write."),
      }),
      execute: async ({ databaseId, title, properties, titleProperty, confirmed }) => {
        try {
          const blocked = requireConfirmed(confirmed)
          if (blocked) return blocked
          const titleKey = titleProperty ?? (await getDatabaseTitleProperty(databaseId))
          const props: Record<string, unknown> = {
            [titleKey]: { title: [{ text: { content: title } }] },
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

    "notion-listDatabases": tool({
      description:
        "List all Notion databases shared with the integration, with their IDs and titles. Use to discover available databases.",
      parameters: z.object({
        limit: z.number().int().min(1).max(50).default(20).describe("Max databases to return"),
      }),
      execute: async ({ limit }) => {
        try {
          const data = await notion<{
            results?: {
              id: string
              object: string
              url: string
              title?: { plain_text: string }[]
              last_edited_time?: string
            }[]
          }>("/search", {
            method: "POST",
            body: JSON.stringify({
              page_size: limit,
              sort: { direction: "descending", timestamp: "last_edited_time" },
              filter: { value: "database", property: "object" },
            }),
          })
          const databases = (data.results ?? []).map((r) => ({
            id: r.id,
            title: extractPlainText(r.title) || "(Untitled)",
            url: r.url,
            lastEdited: r.last_edited_time,
          }))
          if (databases.length === 0) return { databases: [], message: "No databases found." }
          return { count: databases.length, databases }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion-createDatabase": tool({
      description:
        "Create a new Notion database as a child of an existing page. Specify the parent page ID, database title, and property names (all created as rich_text type). For complex property types, use the propertiesJson parameter.",
      parameters: z.object({
        parentPageId: z.string().describe("ID of the parent page to create the database under"),
        title: z.string().describe("Title of the new database"),
        propertyNames: z
          .array(z.string())
          .optional()
          .describe("Property/column names (all created as rich_text)"),
        propertiesJson: z
          .string()
          .optional()
          .describe(
            'JSON string of full property definitions for advanced types: {"Status":{"select":{"options":[{"name":"Todo","color":"gray"}]}}}',
          ),
        confirmed: z
          .boolean()
          .optional()
          .describe("Must be true after the user explicitly confirms this write."),
      }),
      execute: async ({ parentPageId, title, propertyNames, propertiesJson, confirmed }) => {
        try {
          const blocked = requireConfirmed(confirmed)
          if (blocked) return blocked
          let properties: Record<string, unknown> = {}
          if (propertiesJson) {
            try {
              properties = JSON.parse(propertiesJson)
            } catch {
              return { error: "Invalid propertiesJson: must be valid JSON" }
            }
          } else if (propertyNames?.length) {
            for (const name of propertyNames) {
              properties[name] = { rich_text: {} }
            }
          }
          // Ensure at least a title property
          if (!properties.title) {
            properties.title = { title: {} }
          }
          const db = await notion<{ id: string; url?: string }>("/databases", {
            method: "POST",
            body: JSON.stringify({
              parent: { type: "page_id", page_id: parentPageId },
              title: [{ type: "text", text: { content: title } }],
              properties,
            }),
          })
          return { id: db.id, url: db.url, title }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion-listUsers": tool({
      description: "List users in the Notion workspace who have access to the integration.",
      parameters: z.object({
        limit: z.number().int().min(1).max(50).default(20).describe("Max users to return"),
      }),
      execute: async ({ limit }) => {
        try {
          const data = await notion<{
            results?: {
              id: string
              name?: string
              avatar_url?: string
              type?: string
              person?: { email?: string }
            }[]
          }>(`/users?page_size=${limit}`)
          const users = (data.results ?? []).map((u) => ({
            id: u.id,
            name: u.name ?? "(Unknown)",
            avatar: u.avatar_url ?? null,
            type: u.type ?? "bot",
            email: u.person?.email ?? null,
          }))
          if (users.length === 0) return { users: [], message: "No users found." }
          return { count: users.length, users }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "notion-getDatabaseSchema": tool({
      description:
        "Get the full schema (property definitions) of a Notion database. Returns each property name, type, and configuration details.",
      parameters: z.object({
        databaseId: z.string().describe("Notion database ID"),
      }),
      execute: async ({ databaseId }) => {
        try {
          const db = await notion<{
            id: string
            title?: { plain_text: string }[]
            url?: string
            properties?: Record<
              string,
              {
                type: string
                id: string
                [key: string]: unknown
              }
            >
          }>(`/databases/${databaseId}`)
          const title = extractPlainText(db.title) || "(Untitled)"
          const properties = Object.entries(db.properties ?? {}).map(([name, prop]) => ({
            name,
            type: prop.type,
            id: prop.id,
          }))
          return {
            id: db.id,
            title,
            propertyCount: properties.length,
            properties,
          }
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
  description:
    "Search, read, create, and update pages and database entries in your Notion workspace.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/notion",
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
