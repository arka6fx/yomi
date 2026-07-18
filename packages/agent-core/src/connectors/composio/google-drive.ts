import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const DRIVE_TOOLKIT = "googledrive"

export const driveComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLEDRIVE_SEARCH_FILES",
    description:
      "Search for files in Google Drive by name, type, or content. Returns file names, types, last modified date, and links. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Search query (supports Drive query syntax, e.g. \"name contains 'budget'\")"),
        page_size: z.number().int().min(1).max(50).optional().describe("Max results to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_LIST_FILES",
    description:
      "List files in Google Drive, sorted by most recently modified. Optionally filter to a specific folder. Read-only.",
    parameters: z
      .object({
        folder_id: z.string().optional().describe("Drive folder ID to list. Omit to list all accessible files."),
        page_size: z.number().int().min(1).max(50).optional().describe("Max files to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_GET_FILE",
    description:
      "Get metadata for a specific Google Drive file by ID: name, type, size, modified/created dates, and link. Read-only.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_READ_FILE",
    description:
      "Read the text content of a Google Drive file. Works for Google Docs, Sheets (exported as CSV), and text files. Read-only.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_DOWNLOAD_FILE",
    description:
      "Download a file from Google Drive. Returns the file content in base64 encoding. For text content, prefer GOOGLEDRIVE_READ_FILE instead. Read-only.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEDRIVE_GET_STORAGE_QUOTA",
    description:
      "Get the user's Google Drive storage usage, total limit, and remaining free space. Read-only.",
    parameters: z.object({}).passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLEDRIVE_CREATE_FILE",
    description:
      "Create a new file in Google Drive. Supports Google Docs, Sheets, and plain text. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Name of the new file"),
        mime_type: z.string().optional().describe("MIME type (defaults to 'application/vnd.google-apps.document' for Docs)"),
        content: z.string().optional().describe("Text content for the file"),
        folder_id: z.string().optional().describe("Drive folder ID to create the file in"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Drive file: ${String(a["name"] ?? "")}`,
      preview: `${String(a["name"] ?? "")}${a["folder_id"] ? ` in folder ${String(a["folder_id"]).slice(0, 12)}` : ""}`,
      confirmText: "Create file",
    }),
  },
  {
    slug: "GOOGLEDRIVE_UPLOAD_FILE",
    description:
      "Upload file content to Google Drive. Creates or overwrites a file with the provided content. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("File name"),
        content: z.string().describe("File content (base64-encoded for binary, plain text for text)"),
        mime_type: z.string().optional().describe("MIME type of the file"),
        folder_id: z.string().optional().describe("Drive folder ID to upload to"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Upload file: ${String(a["name"] ?? "")}`,
      preview: `Upload "${String(a["name"] ?? "")}"${a["folder_id"] ? ` to folder ${String(a["folder_id"]).slice(0, 12)}` : ""}`,
      confirmText: "Upload file",
    }),
  },
  {
    slug: "GOOGLEDRIVE_UPDATE_FILE",
    description:
      "Rename a Drive file and/or move it between folders. Requires user approval before it runs.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID"),
        name: z.string().optional().describe("New file name"),
        add_to_folder_id: z.string().optional().describe("Folder ID to add the file to"),
        remove_from_folder_id: z.string().optional().describe("Folder ID to remove the file from"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update Drive file ${String(a["file_id"] ?? "").slice(0, 12)}`,
      preview: [
        a["name"] ? `New name: ${String(a["name"])}` : null,
        a["add_to_folder_id"] ? `Move to folder: ${String(a["add_to_folder_id"]).slice(0, 12)}` : null,
      ].filter(Boolean).join("\n") || "Update file details",
      confirmText: "Update file",
    }),
  },
  {
    slug: "GOOGLEDRIVE_COPY_FILE",
    description:
      "Copy (duplicate) a Google Drive file. Optionally specify a new name and target folder. Requires user approval before it runs.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID to copy"),
        name: z.string().optional().describe("New name for the copy"),
        folder_id: z.string().optional().describe("Folder ID to place the copy in"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Copy Drive file ${String(a["file_id"] ?? "").slice(0, 12)}`,
      preview: `Copy file ${String(a["file_id"] ?? "").slice(0, 12)}${a["name"] ? ` as "${String(a["name"])}"` : ""}`,
      confirmText: "Copy file",
    }),
  },
  {
    slug: "GOOGLEDRIVE_SHARE_FILE",
    description:
      "Share a Google Drive file with specific users or create a shareable link. Requires user approval before it runs.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID to share"),
        email: z.string().optional().describe("Email to share with (omit for link sharing)"),
        role: z.enum(["reader", "commenter", "writer"]).optional().default("reader").describe("Permission level"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Share Drive file ${String(a["file_id"] ?? "").slice(0, 12)}`,
      preview: a["email"]
        ? `Invite ${String(a["email"])} as ${String(a["role"] ?? "reader")}`
        : `Create shareable link (${String(a["role"] ?? "reader")})`,
      confirmText: "Share file",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLEDRIVE_DELETE_FILE",
    description:
      "Delete a Google Drive file. Moves to trash by default; set permanent=true to delete forever. This CANNOT be undone if permanent. Requires user approval before it runs.",
    parameters: z
      .object({
        file_id: z.string().describe("Google Drive file ID to delete"),
        permanent: z.coerce.boolean().optional().describe("If true, permanently delete (cannot be undone)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: a["permanent"] ? "Permanently delete Drive file" : "Trash Drive file",
      preview: `${a["permanent"] ? "Permanently delete" : "Move to trash"} file ${String(a["file_id"] ?? "").slice(0, 12)}.${a["permanent"] ? " This CANNOT be undone." : ""}`,
      confirmText: a["permanent"] ? "Delete permanently" : "Move to trash",
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
