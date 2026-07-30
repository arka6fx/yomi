import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const NOTION_TOOLKIT = "notion"

// Every slug and param below was checked against Composio's live catalog
// (GET /api/v3/tools?toolkit_slug=notion) — 6 slugs were hallucinated
// (RETRIEVE_PAGE, QUERY_DATABASE_WITH_FILTER, LIST_FILE_UPLOADS,
// LIST_DATA_SOURCE_TEMPLATES, APPEND_TEXT_BLOCKS, REPLACE_PAGE_CONTENT don't
// exist), and almost every "real" write action's params were also invented —
// e.g. CREATE_NOTION_PAGE has no markdown/content param at all (page content
// must be added afterward via NOTION_ADD_MULTIPLE_PAGE_CONTENT), database row
// properties are a `[{name,type,value}]` array not a raw JSON object, and
// NOTION_UPDATE_ROW_DATABASE keys off `row_id` not `page_id`.
//
// There's also no "get a page by ID" action in this toolkit — NOTION_FETCH_DATA
// only lists/searches; page content comes from NOTION_FETCH_BLOCK_CONTENTS
// (pages are blocks), and NOTION_QUERY_DATABASE has no filter param at all
// (sorts + pagination only) — filtering database rows isn't currently possible
// through Composio's Notion toolkit.
//
// NOTION_DELETE_BLOCK is Composio's own description: "deleted (archived)" — a
// soft delete like page archiving, not permanent, so it's a plain "write", not
// "irreversible" (the old code overstated this as "CANNOT be undone").
export const notionComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "NOTION_SEARCH_NOTION_PAGE",
    description:
      "Search Notion pages or databases by title. Returns results with IDs, titles, and URLs. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Search text. Omit to list everything accessible."),
        filter_value: z
          .enum(["page", "database"])
          .optional()
          .describe("Restrict results to pages or databases (default page)"),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max results (default 2 — set higher for real use)"),
        start_cursor: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_FETCH_DATA",
    description:
      "List or search pages and/or databases accessible to the integration. There is no separate 'get page by ID' " +
      "action — use this to find a page/database ID, then NOTION_FETCH_BLOCK_CONTENTS for a page's body. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Filter by title/content text"),
        get_pages: z
          .boolean()
          .optional()
          .describe("Fetch pages. Exactly one of get_pages/get_databases/get_all must be true."),
        get_databases: z
          .boolean()
          .optional()
          .describe(
            "Fetch databases. Exactly one of get_pages/get_databases/get_all must be true.",
          ),
        get_all: z
          .boolean()
          .optional()
          .describe("Fetch both. Exactly one of get_pages/get_databases/get_all must be true."),
        page_size: z.number().int().min(1).max(100).optional().describe("Max items (default 100)"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_FETCH_BLOCK_CONTENTS",
    description:
      "Get the content blocks of a Notion page or block. Returns rendered text from paragraphs, headings, lists, and other block types. Read-only.",
    parameters: z
      .object({
        block_id: z.string().describe("Block or page ID (pages are blocks in Notion's model)"),
        page_size: z.number().int().min(1).max(100).optional(),
        start_cursor: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_FETCH_DATABASE",
    description: "Get the schema (property definitions) of a Notion database. Read-only.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_QUERY_DATABASE",
    description:
      "List rows in a Notion database, with optional sorting. There is no filter parameter — this always returns " +
      "all rows (paginated); filter client-side if you only need some of them. Read-only.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
        sorts: z
          .array(z.object({ property_name: z.string(), ascending: z.boolean() }).passthrough())
          .optional()
          .describe("Sort rules, e.g. [{ property_name: 'Due', ascending: false }]"),
        page_size: z
          .number()
          .int()
          .optional()
          .describe("Max rows (default 2 — set higher for real use)"),
        start_cursor: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_LIST_USERS",
    description:
      "List users in the Notion workspace who have access to the integration. Read-only.",
    parameters: z
      .object({
        page_size: z.number().int().max(100).optional().describe("Max users (default 30)"),
        start_cursor: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "NOTION_FETCH_COMMENTS",
    description: "List comments on a Notion page or block. Read-only.",
    parameters: z
      .object({
        block_id: z.string().describe("Notion page or block ID"),
        page_size: z.number().int().max(100).optional().describe("Max comments (default 100)"),
        start_cursor: z.string().optional(),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "NOTION_CREATE_NOTION_PAGE",
    description:
      "Create a new, empty Notion page under a parent page or database (title only — there's no content param). " +
      "To add body content, follow up with NOTION_ADD_MULTIPLE_PAGE_CONTENT using the new page's ID. Requires user approval before it runs.",
    parameters: z
      .object({
        parent_id: z.string().describe("Parent page or database ID"),
        title: z.string().describe("Page title"),
        icon: z.string().optional().describe("Single emoji to use as the page icon"),
        cover: z.string().optional().describe("Public URL of a cover image"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Notion page: ${String(a["title"] ?? "")}`,
      preview: `Create page under ${String(a["parent_id"] ?? "?")}`,
      confirmText: "Create page",
    }),
  },
  {
    slug: "NOTION_ADD_MULTIPLE_PAGE_CONTENT",
    description:
      "Append content blocks to a Notion page or block — paragraphs, headings, bulleted/numbered lists, quotes, " +
      "callouts, to-dos. Each block's 'content' text auto-parses **bold**, *italic*, ~~strikethrough~~, `code`, and " +
      "[links](url). Requires user approval before it runs.",
    parameters: z
      .object({
        parent_block_id: z.string().describe("Page or block ID to append to"),
        content_blocks: z
          .array(
            z.object({
              content_block: z
                .object({
                  content: z.string().describe("Block text — supports inline markdown formatting"),
                  block_property: z
                    .enum([
                      "paragraph",
                      "heading_1",
                      "heading_2",
                      "heading_3",
                      "callout",
                      "to_do",
                      "toggle",
                      "quote",
                      "bulleted_list_item",
                      "numbered_list_item",
                    ])
                    .optional()
                    .describe("Block type (default paragraph)"),
                })
                .passthrough(),
            }),
          )
          .min(1)
          .max(100)
          .describe(
            "Blocks to append, e.g. [{ content_block: { content: 'Title', block_property: 'heading_1' } }]",
          ),
        after: z
          .string()
          .optional()
          .describe("Existing block ID to insert after (omit to append at the end)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Append content to Notion page ${String(a["parent_block_id"] ?? "").slice(0, 12)}`,
      preview: `Add ${String((a["content_blocks"] as unknown[])?.length ?? 0)} block(s)`,
      confirmText: "Append content",
    }),
  },
  {
    slug: "NOTION_UPDATE_PAGE",
    description:
      "Update a Notion page's icon, cover, archived state, or raw property values (title is a property — set it via " +
      "properties, e.g. { Name: { title: [{ text: { content: 'New title' } }] } }). Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID to update"),
        properties: z
          .object({})
          .passthrough()
          .optional()
          .describe("Raw Notion property-value object to update"),
        icon: z.object({}).passthrough().optional().describe("e.g. { type: 'emoji', emoji: '🎉' }"),
        cover: z
          .object({})
          .passthrough()
          .optional()
          .describe("e.g. { type: 'external', external: { url: '...' } }"),
        archived: z.boolean().optional().describe("true to archive (trash), false to restore"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update Notion page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview:
        a["archived"] === true
          ? "Archive (trash) this page"
          : a["archived"] === false
            ? "Restore from trash"
            : "Update page",
      confirmText: a["archived"] === true ? "Archive page" : "Update page",
    }),
  },
  {
    slug: "NOTION_ARCHIVE_NOTION_PAGE",
    description:
      "Archive (soft-delete, recoverable) or restore a Notion page. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID"),
        archive: z
          .boolean()
          .optional()
          .describe("true to archive (default), false to restore from trash"),
      })
      .passthrough(),
    preview: (a) => ({
      title: a["archive"] === false ? "Restore Notion page" : "Archive Notion page",
      preview: `${a["archive"] === false ? "Restore" : "Archive"} page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      confirmText: a["archive"] === false ? "Restore page" : "Archive page",
    }),
  },
  {
    slug: "NOTION_DUPLICATE_PAGE",
    description:
      "Duplicate a Notion page under a chosen parent. Requires user approval before it runs.",
    parameters: z
      .object({
        page_id: z.string().describe("Notion page ID to duplicate"),
        parent_id: z
          .string()
          .describe("Parent page/workspace ID for the duplicate (cannot be page_id itself)"),
        title: z
          .string()
          .optional()
          .describe("Title for the duplicate (defaults to 'Copy of <original>')"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Duplicate Notion page ${String(a["page_id"] ?? "").slice(0, 12)}`,
      preview: `Create duplicate${a["title"] ? ` titled "${String(a["title"])}"` : ""}`,
      confirmText: "Duplicate page",
    }),
  },
  {
    slug: "NOTION_DELETE_BLOCK",
    description:
      "Archive (soft-delete, recoverable) a block, page, or database. Requires user approval before it runs.",
    parameters: z
      .object({
        block_id: z.string().describe("Block, page, or database ID to archive"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Archive Notion block",
      preview: `Archive block ${String(a["block_id"] ?? "").slice(0, 12)} (recoverable from trash).`,
      confirmText: "Archive block",
    }),
  },
  {
    slug: "NOTION_INSERT_ROW_DATABASE",
    description:
      "Insert a new row into a Notion database. Property values are a list, not an object — each entry needs name/" +
      "type/value, e.g. [{ name: 'Status', type: 'select', value: 'In Progress' }]. Requires user approval before it runs.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
        properties: z
          .array(z.object({ name: z.string(), type: z.string(), value: z.string() }).passthrough())
          .describe("Column values, e.g. [{ name: 'Title', type: 'title', value: 'Task name' }]"),
        icon: z.string().optional().describe("Single emoji for the row's page icon"),
        cover: z.string().optional().describe("Public cover image URL"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Insert row in Notion database ${String(a["database_id"] ?? "").slice(0, 12)}`,
      preview: JSON.stringify(a["properties"] ?? []).slice(0, 500),
      confirmText: "Insert row",
    }),
  },
  {
    slug: "NOTION_UPDATE_ROW_DATABASE",
    description:
      "Update or archive a row (page) in a Notion database. Uses row_id, not page_id. Set delete_row=true to archive " +
      "the row instead of updating properties. Requires user approval before it runs.",
    parameters: z
      .object({
        row_id: z.string().describe("Database row (page) ID to update"),
        properties: z
          .array(z.object({ name: z.string(), type: z.string(), value: z.string() }).passthrough())
          .optional()
          .describe(
            "Column values to change, e.g. [{ name: 'Status', type: 'select', value: 'Done' }]",
          ),
        delete_row: z
          .boolean()
          .optional()
          .describe("If true, archives the row instead of updating it"),
      })
      .passthrough(),
    preview: (a) => ({
      title: a["delete_row"]
        ? `Archive row ${String(a["row_id"] ?? "").slice(0, 12)}`
        : `Update row ${String(a["row_id"] ?? "").slice(0, 12)}`,
      preview: a["delete_row"]
        ? "Archive this database row"
        : JSON.stringify(a["properties"] ?? []).slice(0, 500),
      confirmText: a["delete_row"] ? "Archive row" : "Update row",
    }),
  },
  {
    slug: "NOTION_CREATE_DATABASE",
    description:
      "Create a new Notion database under a parent page. Properties are a list of column definitions, e.g. " +
      "[{ name: 'Task Name', type: 'title' }, { name: 'Due Date', type: 'date' }] — at least one 'title' column is required. " +
      "Requires user approval before it runs.",
    parameters: z
      .object({
        parent_id: z.string().describe("Parent page ID to create the database under"),
        title: z.string().describe("Title of the new database"),
        properties: z
          .array(z.object({ name: z.string(), type: z.string() }).passthrough())
          .describe("Column definitions, e.g. [{ name: 'Task Name', type: 'title' }]"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Notion database: ${String(a["title"] ?? "")}`,
      preview: `Create database under page ${String(a["parent_id"] ?? "").slice(0, 12)}`,
      confirmText: "Create database",
    }),
  },
  {
    slug: "NOTION_UPDATE_SCHEMA_DATABASE",
    description:
      "Change a Notion database's structure — rename/retype/remove columns, e.g. " +
      "[{ name: 'Status', new_type: 'select' }, { name: 'Priority', remove: true }]. Requires user approval before it runs.",
    parameters: z
      .object({
        database_id: z.string().describe("Notion database ID"),
        title: z.string().optional().describe("New database title"),
        description: z.string().optional(),
        properties: z
          .array(
            z
              .object({
                name: z.string(),
                rename: z.string().optional(),
                new_type: z.string().optional(),
                remove: z.boolean().optional(),
              })
              .passthrough(),
          )
          .optional()
          .describe("Column changes; each item needs 'name' plus one of rename/new_type/remove"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update schema of Notion database ${String(a["database_id"] ?? "").slice(0, 12)}`,
      preview: "Modify database columns",
      confirmText: "Update schema",
    }),
  },
  {
    slug: "NOTION_CREATE_COMMENT",
    description:
      "Add a comment to a Notion page, or reply in an existing comment thread. Requires user approval before it runs.",
    parameters: z
      .object({
        comment: z.object({ content: z.string().describe("Comment text") }).passthrough(),
        parent_page_id: z
          .string()
          .optional()
          .describe("Page to comment on (required if discussion_id is omitted)"),
        discussion_id: z
          .string()
          .optional()
          .describe("Existing thread to reply in (required if parent_page_id is omitted)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Comment on Notion page ${String(a["parent_page_id"] ?? "").slice(0, 12)}`,
      preview: String((a["comment"] as { content?: string } | undefined)?.content ?? "").slice(
        0,
        500,
      ),
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
    description:
      "Search, read, create, and update pages and database entries in Notion (via Composio).",
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
        {
          env: "COMPOSIO_NOTION_AUTH_CONFIG_ID",
          label: "Composio Notion auth config id",
          secret: false,
        },
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
