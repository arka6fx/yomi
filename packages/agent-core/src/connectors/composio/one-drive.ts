import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const ONE_DRIVE_TOOLKIT = "one_drive"

export const oneDriveComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "ONE_DRIVE_GET_QUOTA", description: "Get storage quota for the authenticated user's OneDrive. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "ONE_DRIVE_LIST_DRIVES", description: "List drives available to the authenticated user. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "ONE_DRIVE_GET_DRIVE", description: "Get properties of a specific drive. Read-only.", parameters: z.object({ drive_id: z.string().describe("Drive ID") }).passthrough() },
  { slug: "ONE_DRIVE_ONEDRIVE_LIST_ITEMS", description: "List files and folders in the root of a user's OneDrive. Read-only.", parameters: z.object({ user_id: z.string().optional().describe("User ID (defaults to signed-in user)") }).passthrough() },
  { slug: "ONE_DRIVE_GET_ITEM", description: "Get metadata of a specific file or folder. Read-only.", parameters: z.object({ item_id: z.string().describe("Item ID") }).passthrough() },
  { slug: "ONE_DRIVE_ONEDRIVE_FIND_FILE", description: "Find a file by name within a folder. Read-only.", parameters: z.object({ name: z.string().describe("Filename"), folder: z.string().optional().describe("Folder path") }).passthrough() },
  { slug: "ONE_DRIVE_ONEDRIVE_FIND_FOLDER", description: "Find folders by name. Read-only.", parameters: z.object({ name: z.string().optional().describe("Folder name"), folder: z.string().optional().describe("Parent folder path") }).passthrough() },
  { slug: "ONE_DRIVE_SEARCH_ITEMS", description: "Search for files and folders matching a query. Read-only.", parameters: z.object({ q: z.string().describe("Search query") }).passthrough() },
  { slug: "ONE_DRIVE_DOWNLOAD_FILE", description: "Download a file's content. Read-only.", parameters: z.object({ item_id: z.string().describe("Item ID"), file_name: z.string().describe("Filename to save as") }).passthrough() },
  { slug: "ONE_DRIVE_GET_ITEM_VERSIONS", description: "Get version history of a file or folder. Read-only.", parameters: z.object({ item_id: z.string().describe("Item ID") }).passthrough() },
  { slug: "ONE_DRIVE_GET_ITEM_PERMISSIONS", description: "Get sharing permissions for an item. Read-only.", parameters: z.object({ item_id: z.string().describe("Item ID") }).passthrough() },
  { slug: "ONE_DRIVE_GET_RECENT_ITEMS", description: "List recently used items. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "ONE_DRIVE_GET_SHARED_ITEMS", description: "List items shared with the authenticated user. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "ONE_DRIVE_PREVIEW_DRIVE_ITEM", description: "Generate a short-lived embeddable preview URL for an item. Read-only.", parameters: z.object({ item_id: z.string().describe("Item ID") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "ONE_DRIVE_ONEDRIVE_CREATE_FOLDER",
    description: "Create a new folder in OneDrive. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Folder name"), parent_folder: z.string().optional().describe("Parent folder path") }).passthrough(),
    preview: (a) => ({ title: "Create folder", preview: `Create folder "${String(a["name"] ?? "")}"`, confirmText: "Create folder" }),
  },
  {
    slug: "ONE_DRIVE_ONEDRIVE_UPLOAD_FILE",
    description: "Upload a file to a OneDrive folder. Requires user approval before it runs.",
    parameters: z.object({
      file: z.string().describe("URL of the file to upload"),
      folder: z.string().optional().describe("Destination folder path"),
    }).passthrough(),
    fileParams: ["file"],
    preview: () => ({ title: "Upload file", preview: "Upload a file to OneDrive", confirmText: "Upload" }),
  },
  {
    slug: "ONE_DRIVE_ONEDRIVE_CREATE_TEXT_FILE",
    description: "Create a new text file with specified content. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Filename"), content: z.string().describe("File content"), folder: z.string().optional().describe("Destination folder path") }).passthrough(),
    preview: (a) => ({ title: "Create text file", preview: `Create "${String(a["name"] ?? "")}"`, confirmText: "Create" }),
  },
  {
    slug: "ONE_DRIVE_COPY_ITEM",
    description: "Copy a file or folder to a new location. Requires user approval before it runs.",
    parameters: z.object({ item_id: z.string().describe("Item ID to copy"), name: z.string().optional().describe("New name for the copy") }).passthrough(),
    preview: (a) => ({ title: "Copy item", preview: `Copy item ${String(a["item_id"] ?? "")}`, confirmText: "Copy" }),
  },
  {
    slug: "ONE_DRIVE_MOVE_ITEM",
    description: "Move a file or folder to a new parent folder. Requires user approval before it runs.",
    parameters: z.object({ itemId: z.string().describe("Item ID to move"), parentReference: z.record(z.string(), z.unknown()).describe("New parent folder reference") }).passthrough(),
    preview: (a) => ({ title: "Move item", preview: `Move item ${String(a["itemId"] ?? "")}`, confirmText: "Move" }),
  },
  {
    slug: "ONE_DRIVE_CREATE_LINK",
    description: "Create a sharing link for a file or folder. Requires user approval before it runs.",
    parameters: z.object({ item_id: z.string().describe("Item ID"), type: z.string().describe("'view', 'edit', or 'embed'") }).passthrough(),
    preview: (a) => ({ title: "Create sharing link", preview: `Create ${String(a["type"] ?? "")} link for ${String(a["item_id"] ?? "")}`, confirmText: "Create link" }),
  },
  {
    slug: "ONE_DRIVE_UPDATE_DRIVE_ITEM_METADATA",
    description: "Update a file or folder's metadata (e.g. rename). Requires user approval before it runs.",
    parameters: z.object({ item_id: z.string().describe("Item ID"), name: z.string().optional().describe("New name") }).passthrough(),
    preview: (a) => ({ title: "Update item", preview: `Update item ${String(a["item_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "ONE_DRIVE_INVITE_USER_TO_DRIVE_ITEM",
    description: "Share a file or folder with other users. Requires user approval before it runs.",
    parameters: z.object({ item_id: z.string().describe("Item ID"), recipients: z.array(z.record(z.string(), z.unknown())).describe("Recipients to invite"), roles: z.array(z.string()).describe("Permission roles, e.g. 'read', 'write'") }).passthrough(),
    preview: (a) => ({ title: "Share item", preview: `Share item ${String(a["item_id"] ?? "")}`, confirmText: "Share" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "ONE_DRIVE_DELETE_ITEM",
    description: "Permanently delete a file or folder. This cannot be undone.",
    parameters: z.object({ item_id: z.string().describe("Item ID") }).passthrough(),
    preview: (a) => ({ title: "Delete item", preview: `Delete item ${String(a["item_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioOneDriveDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "one-drive",
    name: "OneDrive",
    category: "productivity",
    icon: "one-drive",
    description: "Microsoft OneDrive — browse, search, upload, share, and organize files and folders (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: ONE_DRIVE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_ONE_DRIVE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a OneDrive auth config in Composio (uses Microsoft OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_ONE_DRIVE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=one-drive to route OneDrive through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_ONE_DRIVE_AUTH_CONFIG_ID", label: "Composio OneDrive auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/one_drive",
    },
    tools: createComposioTools({
      provider: "one-drive",
      toolkit: ONE_DRIVE_TOOLKIT,
      specs: oneDriveComposioSpecs,
      executor,
    }),
  }
}
