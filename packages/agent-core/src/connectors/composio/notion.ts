import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const NOTION_TOOLKIT = "notion"

export const notionComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "NOTION_SEARCH_NOTION_PAGE",
    description:
      "Search Notion pages and databases by title. Returns results with IDs, titles, and URLs. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Search query text"),
        page_size: z.number().int().min(1).max(50).optional().describe("Max results to return"),
        filter_properties: z.array(z.string()).optional().describe("Properties to include in results"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_RETRIEVE_PAGE",
    description:
      "Get full metadata and properties for a specific Notion page by ID. Read-only.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID (from search results or URL)"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_FETCH_BLOCK_CONTENTS",
    description:
      "Get the content blocks of a Notion page. Returns rendered text from paragraphs, headings, lists, and other block types. Read-only.",
    parameters: z
      .object({
        block_id: z.string().describe("Block ID (same as page ID for top-level blocks)"),
        page_size: z.number().int().min(1).max(100).optional().describe("Max blocks to return"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_FETCH_DATABASE",
    description:
      "Get the full schema (property definitions) of a Notion database. Returns each property name, type, and configuration. Read-only.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_QUERY_DATABASE",
    description:
      "Query a Notion database to retrieve rows matching optional filters. Supports filtering, sorting, and pagination. Read-only.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
        filter: z
          .object({})
          .passthrough()
          .optional()
          .describe("Filter conditions as JSON object"),
        sorts: z
          .array(z.object({}).passthrough())
          .optional()
          .describe("Sort specifications as array of JSON objects"),
        page_size: z.number().int().min(1).max(50).optional().describe("Max rows to return"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_QUERY_DATABASE_WITH_FILTER",
    description:
      "Query a Notion database with a structured filter. Allows filtering by property values using Notion filter syntax. Read-only.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
        filter: z
          .object({})
          .passthrough()
          .describe("Filter conditions as JSON object"),
        sorts: z
          .array(z.object({}).passthrough())
          .optional()
          .describe("Sort specifications"),
        page_size: z.number().int().min(1).max(50).optional(),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_LIST_USERS",
    description:
      "List users in the Notion workspace who have access to the integration. Returns user names, emails, and types. Read-only.",
    parameters: z
      .object({
        page_size: z.number().int().min(1).max(50).optional().describe("Max users to return"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_FETCH_COMMENTS",
    description:
      "List comments on a Notion page. Read-only.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID"),
        page_size: z.number().int().min(1).max(50).optional(),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_LIST_FILE_UPLOADS",
    description:
      "List file uploads for the current bot integration, sorted by most recent first. Read-only.",
    parameters: z
      .object({
        page_size: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_LIST_DATA_SOURCE_TEMPLATES",
    description:
      "List all templates for a Notion data source. Useful for discovering template IDs for bulk page creation. Read-only.",
    parameters: z
      .object({
        data_source_id: z.string().describe("Data source ID"),
        page_size: z.number().int().min(1).max(50).optional(),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "NOTION_CREATE_NOTION_PAGE",
    description:
      "Create a new page in a Notion workspace under a specified parent page or database. Supports markdown content. Requires user approval before it runs.",
    parameters: z
      .object({
        parent_id: z.string().describe("Parent page or database ID"),
        title: z.string().optional().describe("Page title"),
        properties: z
          .object({})
          .passthrough()
          .optional()
          .describe("Page property values as JSON object"),
        markdown: z.string().optional().describe("Page content as markdown"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Notion page: ${String(a["title"] ?? "(untitled)")}`,
      preview: `Create page under ${String(a["parent_id"] ?? "?")}${a["markdown"] ? `\n\n${String(a["markdown"]).slice(0, 500)}` : ""}`,
      confirmText: "Create page",
    }),
  },
  {
    slug: "NOTION_UPDATE_PAGE",
    description:
      "Update a Notion page's properties or title, or archive the page. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID to update"),
        properties: z
          .object({})
          .passthrough()
          .optional()
          .describe("Property values to update as JSON object"),
        title: z.string().optional().describe("New page title"),
        archived: z.coerce.boolean().optional().describe("Set to true to archive the page"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update Notion page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview: a["title"]
        ? `New title: ${String(a["title"])}`
        : a["archived"]
          ? "Archive (trash) this page"
          : "Update page properties",
      confirmText: a["archived"] ? "Archive page" : "Update page",
    }),
  },
  {
    slug: "NOTION_ARCHIVE_NOTION_PAGE",
    description:
      "Soft-delete (archive) a Notion page. The page is moved to the trash and can be restored later. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID to archive"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Archive Notion page",
      preview: `Archive page ${String(a["page_id"] ?? "").slice(0, 12)}. The page will be moved to trash.`,
      confirmText: "Archive page",
    }),
  },
  {
    slug: "NOTION_DUPLICATE_PAGE",
    description:
      "Duplicate a Notion page. Creates a copy of the page with the same content and properties. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID to duplicate"),
        title: z.string().optional().describe("Title for the duplicate page"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Duplicate Notion page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview: `Create duplicate${a["title"] ? ` titled "${String(a["title"])}"` : ""}`,
      confirmText: "Duplicate page",
    }),
  },
  {
    slug: "NOTION_ADD_MULTIPLE_PAGE_CONTENT",
    description:
      "Append content blocks (paragraphs, headings, bulleted lists, etc.) to an existing Notion page. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID to append to"),
        content_blocks: z
          .array(z.object({}).passthrough())
          .describe("Array of block objects to append"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Append content to Notion page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview: `Add ${String((a["content_blocks"] as unknown[])?.length ?? 0)} block(s)`,
      confirmText: "Append content",
    }),
  },
  {
    slug: "NOTION_APPEND_TEXT_BLOCKS",
    description:
      "Append text content (paragraphs, headings, lists) to an existing Notion page. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID to append to"),
        text: z.string().describe("Text content to append (supports markdown-like syntax)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Append text to Notion page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview: String(a["text"] ?? "").slice(0, 500),
      confirmText: "Append text",
    }),
  },
  {
    slug: "NOTION_REPLACE_PAGE_CONTENT",
    description:
      "Replace all content blocks of a Notion page with new blocks. This overwrites existing content. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID"),
        content_blocks: z
          .array(z.object({}).passthrough())
          .describe("Array of block objects to replace with"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Replace content on Notion page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview: `Replace all content with ${String((a["content_blocks"] as unknown[])?.length ?? 0)} new block(s). This overwrites existing content.`,
      confirmText: "Replace content",
    }),
  },
  {
    slug: "NOTION_DELETE_BLOCK",
    description:
      "Permanently delete a block from a Notion page. This CANNOT be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        block_id: z.string().describe("Block ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete Notion block",
      preview: `Permanently delete block ${String(a["block_id"] ?? "").slice(0, 12)}. This CANNOT be undone.`,
      confirmText: "Delete block",
    }),
  },
  {
    slug: "NOTION_INSERT_ROW_DATABASE",
    description:
      "Insert a new row (entry) into a Notion database with specified property values. Requires user approval before it runs.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
        properties: z
          .object({})
          .passthrough()
          .describe("Property values as JSON object"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Insert row in Notion database ${String(a["database_id"] ?? "").slice(0, 12)}`,
      preview: JSON.stringify(a["properties"] ?? {}).slice(0, 500),
      confirmText: "Insert row",
    }),
  },
  {
    slug: "NOTION_UPDATE_ROW_DATABASE",
    description:
      "Update property values of an existing row (page) in a Notion database. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID of the row to update"),
        properties: z
          .object({})
          .passthrough()
          .describe("Property values to update as JSON object"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update row in Notion database ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview: JSON.stringify(a["properties"] ?? {}).slice(0, 500),
      confirmText: "Update row",
    }),
  },
  {
    slug: "NOTION_CREATE_DATABASE",
    description:
      "Create a new Notion database as a child of an existing page. Specify the parent page ID, database title, and property definitions. Requires user approval before it runs.",
    parameters: z
      .object({
        parent_id: z.string().describe("Parent page ID to create the database under"),
        title: z.string().describe("Title of the new database"),
        properties: z
          .object({})
          .passthrough()
          .describe("Property definitions as JSON object"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Notion database: ${String(a["title"] ?? "(untitled)")}`,
      preview: `Create database under page ${String(a["parent_id"] ?? "").slice(0, 12)}`,
      confirmText: "Create database",
    }),
  },
  {
    slug: "NOTION_UPDATE_SCHEMA_DATABASE",
    description:
      "Update a Notion database schema — add, rename, or reconfigure properties. This modifies the database structure. Requires user approval before it runs.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
        properties: z
          .object({})
          .passthrough()
          .describe("Property definitions to update as JSON object"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update schema of Notion database ${String(a["database_id"] ?? "").slice(0, 12)}`,
      preview: "Modify database schema — add, rename, or reconfigure properties",
      confirmText: "Update schema",
    }),
  },
  {
    slug: "NOTION_CREATE_COMMENT",
    description:
      "Add a comment to a Notion page. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID to comment on"),
        rich_text: z
          .array(z.object({}).passthrough())
          .describe("Rich text content of the comment"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Comment on Notion page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview: String(
        ((a["rich_text"] as { plain_text?: string }[])?.map((t) => t.plain_text ?? "") ?? []).join(""),
      ).slice(0, 500),
      confirmText: "Post comment",
    }),
  },
]

export function makeComposioNotionDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "notion",
    name: "Notion",
    category: "knowledge",
    icon: "notion",
    description: "Search, read, create, and update pages and database entries in Notion (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: NOTION_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_NOTION_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Notion auth config in Composio (or use the managed one)",
        "Set COMPOSIO_API_KEY and COMPOSIO_NOTION_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=notion to route Notion through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_NOTION_AUTH_CONFIG_ID", label: "Composio Notion auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/notion",
    },
    tools: createComposioTools({
      provider: "notion",
      toolkit: NOTION_TOOLKIT,
      specs: notionComposioSpecs,
      executor,
    }),
  }
}
