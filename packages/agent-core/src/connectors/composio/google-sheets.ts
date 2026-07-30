import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const SHEETS_TOOLKIT = "googlesheets"

// Every slug and param below was checked against Composio's live catalog
// (GET /api/v3/tools?toolkit_slug=googlesheets) before writing this file — see
// the Drive connector's history for why (hallucinated slugs there 404'd on
// every real call). GOOGLESHEETS_CREATE_CHART pairs with the Docs connector's
// GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET / LIST_SPREADSHEET_CHARTS_ACTION —
// build a chart here, pull it into a Doc there.
export const sheetsComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLESHEETS_GET_SPREADSHEET_INFO",
    description:
      "Get a Google Sheet's metadata: title, tabs (sheetId, title, row/column counts). Read-only.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLESHEETS_BATCH_GET",
    description:
      "Read cell values from one or more ranges in a Google Sheet, e.g. 'Sheet1!A1:B2'. Omit ranges to fetch the whole first sheet. Read-only.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
        ranges: z
          .array(z.string())
          .optional()
          .describe("A1-notation ranges, e.g. ['Sheet1!A1:B2']"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLESHEETS_SEARCH_SPREADSHEETS",
    description:
      "Search the user's Google Sheets by name or content, e.g. \"name contains 'budget'\". Read-only.",
    parameters: z
      .object({
        query: z
          .string()
          .optional()
          .describe("Drive query syntax search string. Omit to list all sheets."),
        order_by: z.string().optional().describe("e.g. 'modifiedTime desc' (default), 'name'"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Max results (default 10)"),
        starred_only: z.boolean().optional(),
        shared_with_me: z.boolean().optional(),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLESHEETS_GET_SHEET_NAMES",
    description: "List the tab names inside a Google Sheet. Read-only.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLESHEETS_QUERY_TABLE",
    description:
      "Run a SQL SELECT query against a Google Sheet tab (treat the tab name as a quoted table name). Supports WHERE/ORDER BY/LIMIT. Read-only.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
        sql: z
          .string()
          .describe("SQL SELECT, e.g. 'SELECT * FROM \"Sheet1\" WHERE total > 10 LIMIT 20'"),
        include_formulas: z
          .boolean()
          .optional()
          .describe("Return formula text instead of computed values"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
    description: "Find the row whose cell exactly matches a query string. Read-only.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
        query: z.string().describe("Exact cell value to find"),
        range: z
          .string()
          .optional()
          .describe("A1 range to search, e.g. 'Sheet1!A1:D5'. Defaults to first sheet."),
        case_sensitive: z.boolean().optional(),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
    description: "Create a new, empty Google Sheet. Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().describe("Name for the new spreadsheet"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Google Sheet: ${String(a["title"] ?? "")}`,
      preview: String(a["title"] ?? ""),
      confirmText: "Create sheet",
    }),
  },
  {
    slug: "GOOGLESHEETS_ADD_SHEET",
    description:
      "Add a new tab to an existing Google Sheet. Requires user approval before it runs.",
    parameters: z
      .object({
        spreadsheetId: z.string().describe("Google Sheets spreadsheet ID"),
        properties: z
          .object({
            title: z.string().optional().describe("Name for the new tab"),
            index: z
              .number()
              .int()
              .min(0)
              .optional()
              .describe("Zero-based position for the new tab"),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    preview: (a) => {
      const props = a["properties"] as Record<string, unknown> | undefined
      return {
        title: `Add tab to Sheet ${String(a["spreadsheetId"] ?? "").slice(0, 12)}`,
        preview: props?.["title"] ? `New tab: ${String(props["title"])}` : "Add a new tab",
        confirmText: "Add tab",
      }
    },
  },
  {
    slug: "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
    description:
      "Append rows to the end of a Google Sheet's existing data — never overwrites; Google finds the first empty row and writes below it. Requires user approval before it runs.",
    parameters: z
      .object({
        spreadsheetId: z.string().describe("Google Sheets spreadsheet ID"),
        range: z
          .string()
          .describe("A1 range identifying the table to append after, e.g. 'Sheet1!A1:B2'"),
        values: z
          .array(z.array(z.union([z.string(), z.number(), z.boolean()])))
          .describe("Rows to append — array of arrays, each inner array is one row"),
        valueInputOption: z
          .enum(["RAW", "USER_ENTERED"])
          .describe(
            "RAW stores strings literally (safe for untrusted data); USER_ENTERED evaluates formulas",
          ),
      })
      .passthrough(),
    preview: (a) => {
      const values = a["values"] as unknown[][] | undefined
      const rows = values?.length ?? 0
      return {
        title: `Append ${rows} row${rows === 1 ? "" : "s"} to a Google Sheet`,
        preview: (values ?? [])
          .slice(0, 5)
          .map((r) => r.join(" | "))
          .join("\n"),
        confirmText: "Append rows",
      }
    },
  },
  {
    slug: "GOOGLESHEETS_FORMAT_CELL",
    description:
      "Apply background color, bold/italic/underline/strikethrough, or font size to a cell range. Requires user approval before it runs.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
        worksheet_id: z
          .number()
          .int()
          .describe("Tab's numeric sheetId (from GOOGLESHEETS_GET_SPREADSHEET_INFO)"),
        start_row_index: z.number().int().describe("0-based first row"),
        end_row_index: z.number().int().describe("0-based row after the last row (exclusive)"),
        start_column_index: z.number().int().describe("0-based first column"),
        end_column_index: z
          .number()
          .int()
          .describe("0-based column after the last column (exclusive)"),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        underline: z.boolean().optional(),
        strikethrough: z.boolean().optional(),
        fontSize: z.number().int().optional(),
        red: z.number().min(0).max(1).optional().describe("Background color red component 0.0-1.0"),
        green: z.number().min(0).max(1).optional(),
        blue: z.number().min(0).max(1).optional(),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Format cells in Sheet ${String(a["spreadsheet_id"] ?? "").slice(0, 12)}`,
      preview: `Format rows ${String(a["start_row_index"] ?? "")}-${String(a["end_row_index"] ?? "")}, cols ${String(a["start_column_index"] ?? "")}-${String(a["end_column_index"] ?? "")}`,
      confirmText: "Apply formatting",
    }),
  },
  {
    slug: "GOOGLESHEETS_CREATE_CHART",
    description:
      "Create a chart (BAR, LINE, AREA, COLUMN, SCATTER, COMBO, STEPPED_AREA) from a data range in a Google Sheet. Pull it into a Doc afterward with GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET. Requires user approval before it runs.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
        chart_type: z.string().describe("BAR, LINE, AREA, COLUMN, SCATTER, COMBO, or STEPPED_AREA"),
        data_range: z.string().describe("A1 range for the chart data, e.g. 'Sheet1!A1:C10'"),
        sheet_id: z
          .number()
          .int()
          .optional()
          .describe("Tab to place the chart in (default 0, first sheet)"),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        x_axis_title: z.string().optional(),
        y_axis_title: z.string().optional(),
        legend_position: z
          .enum(["BOTTOM_LEGEND", "TOP_LEGEND", "LEFT_LEGEND", "RIGHT_LEGEND", "NO_LEGEND"])
          .optional(),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create ${String(a["chart_type"] ?? "")} chart in Sheet`,
      preview: `${String(a["title"] ?? "Untitled chart")} from ${String(a["data_range"] ?? "")}`,
      confirmText: "Create chart",
    }),
  },
  {
    slug: "GOOGLESHEETS_CLEAR_VALUES",
    description:
      "Clear cell values in a range, leaving formatting intact. Destructive to the data (recoverable via the Sheet's version history). Requires user approval before it runs.",
    parameters: z
      .object({
        spreadsheet_id: z.string().describe("Google Sheets spreadsheet ID"),
        range: z.string().describe("A1 range to clear, e.g. 'Sheet1!A1:B10'"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Clear values in Sheet ${String(a["spreadsheet_id"] ?? "").slice(0, 12)}`,
      preview: `Clear ${String(a["range"] ?? "")}`,
      confirmText: "Clear values",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLESHEETS_DELETE_SHEET",
    description:
      "Delete a tab from a Google Sheet, including all its data. This CANNOT be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        spreadsheetId: z.string().describe("Google Sheets spreadsheet ID"),
        sheet_id: z.number().int().describe("Numeric sheetId of the tab to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete a Sheet tab",
      preview: `Permanently delete tab ${String(a["sheet_id"] ?? "")} from ${String(a["spreadsheetId"] ?? "").slice(0, 12)}. This CANNOT be undone.`,
      confirmText: "Delete tab",
    }),
  },
]

export function makeComposioSheetsDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-sheets",
    name: "Google Sheets",
    category: "productivity",
    icon: "google-sheets",
    description: "Read, create, and edit spreadsheets — rows, formulas, and charts (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: SHEETS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SHEETS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_SHEETS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-sheets to route Sheets through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_SHEETS_AUTH_CONFIG_ID",
          label: "Composio Sheets auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googlesheets",
    },
    tools: createComposioTools({
      provider: "google-sheets",
      toolkit: SHEETS_TOOLKIT,
      specs: sheetsComposioSpecs,
      executor,
    }),
  }
}
