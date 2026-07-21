import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const DROPBOX_TOOLKIT = "dropbox"

// Real Dropbox catalog is basic file/folder ops only — no team admin, no
// sharing-link management, no batch operations, no Paper doc listing.
export const dropboxComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "DROPBOX_GET_ABOUT_ME",
    description: "Get the current user's Dropbox account info (name, email, storage usage). Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "DROPBOX_LIST_FILES_IN_FOLDER",
    description: "List files and folders in a Dropbox directory. Read-only.",
    parameters: z.object({
      path: z.string().optional().describe("Folder path (empty for root)"),
      limit: z.number().int().optional().describe("Max results"),
      recursive: z.boolean().optional().describe("List recursively"),
    }).passthrough(),
  },
  {
    slug: "DROPBOX_LIST_FOLDERS",
    description: "List folders, files, and deleted entries from a Dropbox path. Read-only.",
    parameters: z.object({
      path: z.string().optional().describe("Folder path (empty for root)"),
      limit: z.number().int().optional().describe("Max results"),
      recursive: z.boolean().optional().describe("List recursively"),
    }).passthrough(),
  },
  {
    slug: "DROPBOX_SEARCH_FILE_OR_FOLDER",
    description: "Search for files and folders by name or content. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "DROPBOX_READ_FILE",
    description: "Download/read a file's content from Dropbox. Read-only.",
    parameters: z.object({ path: z.string().describe("File path") }).passthrough(),
  },
  {
    slug: "DROPBOX_CREATE_FOLDER",
    description: "Create a new folder in Dropbox. Requires user approval before it runs.",
    parameters: z.object({ path: z.string().describe("Path for the new folder"), autorename: z.boolean().optional().describe("Auto-rename on conflict") }).passthrough(),
    preview: (a) => ({ title: "Create folder", preview: `Create folder ${String(a["path"] ?? "")}`, confirmText: "Create folder" }),
  },
  {
    slug: "DROPBOX_UPLOAD_FILE",
    description: "Upload a file to Dropbox. Requires user approval before it runs.",
    parameters: z.object({ path: z.string().describe("Destination path"), mode: z.string().optional().describe("Write mode: 'add', 'overwrite', 'update'") }).passthrough(),
    preview: (a) => ({ title: "Upload file", preview: `Upload to ${String(a["path"] ?? "")}`, confirmText: "Upload" }),
  },
  {
    slug: "DROPBOX_CREATE_FILE_REQUEST",
    description: "Create a file request link so others can send you files. Requires user approval before it runs.",
    parameters: z.object({ title: z.string().describe("File request title"), destination: z.string().describe("Folder path to collect files in") }).passthrough(),
    preview: (a) => ({ title: "Create file request", preview: `Create file request "${String(a["title"] ?? "")}"`, confirmText: "Create" }),
  },
  {
    slug: "DROPBOX_CREATE_PAPER",
    description: "Create a new Dropbox Paper document. Requires user approval before it runs.",
    parameters: z.object({ path: z.string().describe("Path for the new Paper doc"), content: z.string().describe("HTML or Markdown content") }).passthrough(),
    preview: (a) => ({ title: "Create Paper doc", preview: `Create Paper doc at ${String(a["path"] ?? "")}`, confirmText: "Create" }),
  },
  {
    slug: "DROPBOX_MOVE_FILE_OR_FOLDER",
    description: "Move or rename a file or folder in Dropbox. Requires user approval before it runs.",
    parameters: z.object({ from_path: z.string().describe("Current path"), to_path: z.string().describe("New path") }).passthrough(),
    preview: (a) => ({ title: "Move file/folder", preview: `Move ${String(a["from_path"] ?? "")} → ${String(a["to_path"] ?? "")}`, confirmText: "Move" }),
  },
  {
    slug: "DROPBOX_DELETE_FILE_OR_FOLDER",
    description: "Permanently delete a file or folder in Dropbox. This cannot be undone.",
    parameters: z.object({ path: z.string().describe("Path to delete") }).passthrough(),
    preview: (a) => ({ title: "Delete file/folder", preview: `Delete ${String(a["path"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioDropboxDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "dropbox",
    name: "Dropbox",
    category: "file-management",
    icon: "dropbox",
    description: "Dropbox — browse, search, upload, and organize files and folders (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: DROPBOX_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_DROPBOX_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Dropbox auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_DROPBOX_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=dropbox to route Dropbox through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_DROPBOX_AUTH_CONFIG_ID", label: "Composio Dropbox auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/dropbox",
    },
    tools: createComposioTools({
      provider: "dropbox",
      toolkit: DROPBOX_TOOLKIT,
      specs: dropboxComposioSpecs,
      executor,
    }),
  }
}
