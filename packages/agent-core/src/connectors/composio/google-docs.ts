import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const DOCS_TOOLKIT = "googledocs"

// Every slug and param below was checked against Composio's live catalog
// (GET /api/v3/tools?toolkit_slug=googledocs) before writing this file — see the
// Drive connector's history for why that discipline matters (hallucinated slugs
// there 404'd on every real call). GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET and
// GOOGLEDOCS_LIST_SPREADSHEET_CHARTS_ACTION are cross-connector reads: they pull
// chart data straight out of a Google Sheet without touching the Docs document.
export const docsComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLEDOCS_GET_DOCUMENT_BY_ID",
    description: "Fetch an existing Google Doc's full content and structure by ID. Read-only.",
    parameters: z
      .object({
        id: z.string().describe("Google Docs document ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDOCS_SEARCH_DOCUMENTS",
    description:
      "Search the user's Google Docs by name or content, e.g. \"name contains 'report'\" or \"fullText contains 'budget'\". Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Drive query syntax search string. Omit to list all docs."),
        order_by: z.string().optional().describe("e.g. 'modifiedTime desc' (default), 'name', 'createdTime desc'"),
        max_results: z.number().int().min(1).max(1000).optional().describe("Max results (default 10)"),
        starred_only: z.boolean().optional(),
        shared_with_me: z.boolean().optional(),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDOCS_LIST_SPREADSHEET_CHARTS_ACTION",
    description:
      "List the charts in a Google Sheet (chart IDs and titles) — call this before GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET to find a chart to pull into a Doc. Cross-connector read against Sheets. Read-only.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET",
    description:
      "Fetch the actual chart images/data from a Google Sheet, to reference or describe in a Doc. Cross-connector read against Sheets. Read-only.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
    description:
      "Create a new Google Doc from Markdown — headings, bold/italic, tables, lists, blockquotes, code blocks, and images (public URLs) all render as real formatting. Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().describe("Title for the new document"),
        markdown_text: z.string().describe("Document content as Markdown. Empty string creates a title-only doc."),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Google Doc: ${String(a["title"] ?? "")}`,
      preview: String(a["markdown_text"] ?? "").slice(0, 500),
      confirmText: "Create doc",
    }),
  },
  {
    slug: "GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN",
    description:
      "Replace an existing Google Doc's ENTIRE content with new Markdown. Destructive to the old content (recoverable via the Doc's version history). Requires user approval before it runs.",
    parameters: z
      .object({
        document_id: z.string().describe("Google Docs document ID"),
        new_markdown_text: z.string().describe("Markdown that replaces the document's full content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Replace content of Doc ${String(a["document_id"] ?? "").slice(0, 12)}`,
      preview: String(a["new_markdown_text"] ?? "").slice(0, 500),
      confirmText: "Replace content",
    }),
  },
  {
    slug: "GOOGLEDOCS_INSERT_TEXT_ACTION",
    description:
      "Insert plain text at a specific character index in a Google Doc. Use index 1 to insert at the very start. Requires user approval before it runs.",
    parameters: z
      .object({
        document_id: z.string().describe("Google Docs document ID"),
        text_to_insert: z.string().describe("Text to insert"),
        insertion_index: z.number().int().describe("Zero-based UTF-16 index to insert at (1 = document start)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Insert text into Doc ${String(a["document_id"] ?? "").slice(0, 12)}`,
      preview: String(a["text_to_insert"] ?? "").slice(0, 500),
      confirmText: "Insert text",
    }),
  },
  {
    slug: "GOOGLEDOCS_REPLACE_ALL_TEXT",
    description:
      "Find and replace every occurrence of text throughout a Google Doc. Requires user approval before it runs.",
    parameters: z
      .object({
        document_id: z.string().describe("Google Docs document ID"),
        find_text: z.string().describe("Text to find"),
        replace_text: z.string().describe("Replacement text"),
        match_case: z.boolean().describe("Case-sensitive search"),
        search_by_regex: z.boolean().optional().describe("Treat find_text as a regular expression"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Replace text in Doc ${String(a["document_id"] ?? "").slice(0, 12)}`,
      preview: `Replace every "${String(a["find_text"] ?? "")}" with "${String(a["replace_text"] ?? "")}"`,
      confirmText: "Replace text",
    }),
  },
  {
    slug: "GOOGLEDOCS_CREATE_PARAGRAPH_BULLETS",
    description:
      "Apply a bullet or numbered-list preset to a range of paragraphs in a Google Doc. Requires user approval before it runs.",
    parameters: z
      .object({
        document_id: z.string().describe("Google Docs document ID"),
        createParagraphBullets: z
          .object({
            range: z
              .object({
                startIndex: z.number().int().describe("Zero-based inclusive start index"),
                endIndex: z.number().int().describe("Zero-based exclusive end index"),
                segmentId: z.string().optional().describe("Header/footer/footnote ID; omit for the document body"),
              })
              .passthrough(),
            bulletPreset: z
              .enum([
                "BULLET_DISC_CIRCLE_SQUARE",
                "BULLET_DIAMONDX_ARROW3D_SQUARE",
                "BULLET_CHECKBOX",
                "BULLET_ARROW_DIAMOND_DISC",
                "BULLET_STAR_CIRCLE_SQUARE",
                "BULLET_ARROW3D_CIRCLE_SQUARE",
                "BULLET_LEFTTRIANGLE_DIAMOND_DISC",
                "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE",
                "BULLET_DIAMOND_CIRCLE_SQUARE",
                "NUMBERED_DECIMAL_ALPHA_ROMAN",
                "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS",
                "NUMBERED_DECIMAL_NESTED",
                "NUMBERED_UPPERALPHA_ALPHA_ROMAN",
                "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL",
                "NUMBERED_ZERODECIMAL_ALPHA_ROMAN",
              ])
              .describe("Bullet or numbering glyph style"),
          })
          .passthrough()
          .describe("The bullet preset request, matching the Docs API's createParagraphBullets shape"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Add bullets to Doc ${String(a["document_id"] ?? "").slice(0, 12)}`,
      preview: "Apply bullet/numbered list formatting to the selected range",
      confirmText: "Apply bullets",
    }),
  },
  {
    slug: "GOOGLEDOCS_INSERT_TABLE_ACTION",
    description: "Insert a table into a Google Doc. Requires user approval before it runs.",
    parameters: z
      .object({
        documentId: z.string().describe("Google Docs document ID"),
        rows: z.number().int().min(1).describe("Number of rows"),
        columns: z.number().int().min(1).describe("Number of columns"),
        index: z.number().int().optional().describe("Zero-based insertion index. Omit to insert at document end."),
        insertAtEndOfSegment: z.boolean().optional().describe("Insert at the end of the body/header/footer"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Insert ${String(a["rows"] ?? "")}x${String(a["columns"] ?? "")} table into Doc`,
      preview: `Insert a ${String(a["rows"] ?? "")}x${String(a["columns"] ?? "")} table into ${String(a["documentId"] ?? "").slice(0, 12)}`,
      confirmText: "Insert table",
    }),
  },
  {
    slug: "GOOGLEDOCS_INSERT_INLINE_IMAGE",
    description:
      "Insert an image into a Google Doc from a public image URL (PNG/JPEG/GIF, under 50MB). Requires user approval before it runs.",
    parameters: z
      .object({
        documentId: z.string().describe("Google Docs document ID"),
        uri: z.string().describe("Public image URL (max 2kB)"),
        location: z
          .object({
            index: z.number().int().optional().describe("Zero-based insertion index. Omit to insert at segment end."),
            segmentId: z.string().optional(),
          })
          .passthrough()
          .describe("Where in the document to insert the image"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Insert image into Doc ${String(a["documentId"] ?? "").slice(0, 12)}`,
      preview: String(a["uri"] ?? ""),
      confirmText: "Insert image",
    }),
  },
  {
    slug: "GOOGLEDOCS_COPY_DOCUMENT",
    description: "Copy (duplicate) a Google Doc. Requires user approval before it runs.",
    parameters: z
      .object({
        document_id: z.string().describe("Google Docs document ID to copy"),
        title: z.string().optional().describe("Title for the copy (defaults to 'Copy of <original>')"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Copy Doc ${String(a["document_id"] ?? "").slice(0, 12)}`,
      preview: a["title"] ? `Copy as "${String(a["title"])}"` : "Create a copy",
      confirmText: "Copy doc",
    }),
  },
]

export function makeComposioDocsDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-docs",
    name: "Google Docs",
    category: "productivity",
    icon: "google-docs",
    description: "Create and edit richly formatted Google Docs from Markdown (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: DOCS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_DOCS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_DOCS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-docs to route Docs through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_DOCS_AUTH_CONFIG_ID", label: "Composio Docs auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googledocs",
    },
    tools: createComposioTools({
      provider: "google-docs",
      toolkit: DOCS_TOOLKIT,
      specs: docsComposioSpecs,
      executor,
    }),
  }
}
