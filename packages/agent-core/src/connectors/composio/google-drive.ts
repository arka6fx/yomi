import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const DRIVE_TOOLKIT = "googledrive"

// Every slug and param name below was checked against Composio's live catalog
// (GET /api/v3/tools?toolkit_slug=googledrive) — the original set was hallucinated
// during the migration and 404'd on every real call, same class of bug as the
// gmail/classroom/github/linear fix. Google Drive API fields are camelCase
// (fileId, folderId, pageSize); several Composio actions instead use snake_case
// (file_id, mime_type) — mixed per-action, not a toolkit-wide convention.
export const driveComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLEDRIVE_FIND_FILE",
    description:
      "Search for files in Google Drive by name, type, or content using Drive query syntax. Returns file names, types, last modified date, and links. Read-only.",
    parameters: z
      .object({
        q: z.string().optional().describe("Search query (Drive query syntax, e.g. \"name contains 'budget'\")"),
        pageSize: z.number().int().min(1).max(1000).optional().describe("Max results to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_LIST_FILES",
    description:
      "List files in Google Drive, sorted by most recently modified. Optionally filter to a specific folder. Read-only.",
    parameters: z
      .object({
        folderId: z.string().optional().describe("Drive folder ID to list. Omit to list all accessible files."),
        pageSize: z.number().int().min(1).max(1000).optional().describe("Max files to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_GET_FILE_METADATA",
    description:
      "Get metadata for a specific Google Drive file by ID: name, type, size, modified/created dates, and link. Read-only.",
    parameters: z
      .object({
        fileId: z.string().describe("Google Drive file ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_PARSE_FILE",
    description:
      "Extract the text content of a Google Drive file, converting Google Docs/Sheets/Slides to a plain format. Read-only.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID"),
        mime_type: z
          .string()
          .optional()
          .describe("Target export MIME type for Google Workspace files, e.g. 'text/plain'"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_DOWNLOAD_FILE",
    description:
      "Download a file from Google Drive. Returns the file content in base64 encoding. For text content, prefer GOOGLEDRIVE_PARSE_FILE instead. Read-only.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID"),
        mime_type: z
          .string()
          .optional()
          .describe("Target export MIME type for Google Workspace files, e.g. 'application/pdf'"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_GET_ABOUT",
    description:
      "Get the user's Google Drive storage usage, total limit, and remaining free space. Read-only.",
    parameters: z.object({}).passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
    description:
      "Create a new file in Google Drive from plain text content. Supports Google Docs, Sheets, Slides, or plain text via mime_type. Requires user approval before it runs.",
    parameters: z
      .object({
        file_name: z.string().describe("Name of the new file"),
        text_content: z.string().describe("Text content for the file"),
        mime_type: z
          .string()
          .optional()
          .describe("MIME type (defaults to 'text/plain'; use 'application/vnd.google-apps.document' for Docs)"),
        parent_id: z.string().optional().describe("Drive folder ID to create the file in"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Drive file: ${String(a["file_name"] ?? "")}`,
      preview: `${String(a["file_name"] ?? "")}${a["parent_id"] ? ` in folder ${String(a["parent_id"]).slice(0, 12)}` : ""}`,
      confirmText: "Create file",
    }),
  },
  {
    slug: "GOOGLEDRIVE_UPDATE_FILE_PUT",
    description:
      "Rename a Drive file and/or move it between folders. Requires user approval before it runs.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID"),
        name: z.string().optional().describe("New file name"),
        add_parents: z.string().optional().describe("Comma-separated folder IDs to add the file to"),
        remove_parents: z.string().optional().describe("Comma-separated folder IDs to remove the file from"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update Drive file ${String(a["file_id"] ?? "").slice(0, 12)}`,
      preview: [
        a["name"] ? `New name: ${String(a["name"])}` : null,
        a["add_parents"] ? `Move to folder: ${String(a["add_parents"]).slice(0, 12)}` : null,
      ].filter(Boolean).join("\n") || "Update file details",
      confirmText: "Update file",
    }),
  },
  {
    slug: "GOOGLEDRIVE_COPY_FILE",
    description:
      "Copy (duplicate) a Google Drive file. Optionally specify a new name. Requires user approval before it runs.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID to copy"),
        new_title: z.string().optional().describe("Name for the copy (defaults to 'Copy of <original>')"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Copy Drive file ${String(a["file_id"] ?? "").slice(0, 12)}`,
      preview: `Copy file ${String(a["file_id"] ?? "").slice(0, 12)}${a["new_title"] ? ` as "${String(a["new_title"])}"` : ""}`,
      confirmText: "Copy file",
    }),
  },
  {
    slug: "GOOGLEDRIVE_ADD_FILE_SHARING_PREFERENCE",
    description:
      "Share a Google Drive file with a specific user, group, or domain, or make it link-shareable to anyone. Requires user approval before it runs.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID to share"),
        role: z.enum(["reader", "commenter", "writer"]).describe("Permission level"),
        type: z.enum(["user", "group", "domain", "anyone"]).describe("Who the permission is for"),
        email_address: z.string().optional().describe("Email to share with. Required if type is 'user' or 'group'"),
        domain: z.string().optional().describe("Domain to share with. Required if type is 'domain'"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Share Drive file ${String(a["file_id"] ?? "").slice(0, 12)}`,
      preview: a["email_address"]
        ? `Invite ${String(a["email_address"])} as ${String(a["role"] ?? "reader")}`
        : a["type"] === "anyone"
          ? `Create shareable link (${String(a["role"] ?? "reader")})`
          : `Share with ${String(a["type"] ?? "")}${a["domain"] ? ` (${String(a["domain"])})` : ""} as ${String(a["role"] ?? "reader")}`,
      confirmText: "Share file",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLEDRIVE_GOOGLE_DRIVE_DELETE_FOLDER_OR_FILE_ACTION",
    description:
      "Permanently delete a Google Drive file or folder. Google's Drive API skips the trash for this action — it CANNOT be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        fileId: z.string().describe("Google Drive file or folder ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Permanently delete Drive file",
      preview: `Permanently delete file ${String(a["fileId"] ?? "").slice(0, 12)}. This CANNOT be undone.`,
      confirmText: "Delete permanently",
    }),
  },
]

export function makeComposioDriveDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-drive",
    name: "Google Drive",
    category: "productivity",
    icon: "google-drive",
    description: "View, search, create, and manage files in Google Drive (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: DRIVE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_DRIVE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_DRIVE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-drive to route Drive through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_DRIVE_AUTH_CONFIG_ID", label: "Composio Drive auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googledrive",
    },
    tools: createComposioTools({
      provider: "google-drive",
      toolkit: DRIVE_TOOLKIT,
      specs: driveComposioSpecs,
      executor,
    }),
  }
}
