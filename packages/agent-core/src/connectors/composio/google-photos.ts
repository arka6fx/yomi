import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

// Composio's real toolkit slug is "googlephotos" (no underscore) — verified
// against the live auth-configs/tools catalog, not "google_photos".
export const GOOGLE_PHOTOS_TOOLKIT = "googlephotos"

export const googlePhotosComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLEPHOTOS_LIST_ALBUMS",
    description: "List all Google Photos albums. Read-only.",
    parameters: z.object({
      pageSize: z.number().int().optional().describe("Max results per page"),
      pageToken: z.string().optional().describe("Pagination token"),
    }).passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_GET_ALBUM",
    description: "Get details of a specific album. Read-only.",
    parameters: z.object({ albumId: z.string().describe("Google Photos album ID") }).passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_LIST_MEDIA_ITEMS",
    description: "List media items in the user's library. Read-only.",
    parameters: z.object({
      pageSize: z.number().int().optional().describe("Max results per page"),
      pageToken: z.string().optional().describe("Pagination token"),
    }).passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_SEARCH_MEDIA_ITEMS",
    description: "Search media items by album or filters. Read-only.",
    parameters: z.object({
      albumId: z.string().optional().describe("Restrict search to this album"),
      pageSize: z.number().int().optional().describe("Max results per page"),
    }).passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_BATCH_GET_MEDIA_ITEMS",
    description: "Get details for a batch of media items by ID. Read-only.",
    parameters: z.object({ mediaItemIds: z.array(z.string()).describe("Media item IDs") }).passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_GET_MEDIA_ITEM_DOWNLOAD",
    description: "Download a media item's file content. Read-only.",
    parameters: z.object({ mediaItemId: z.string().describe("Google Photos media item ID") }).passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_CREATE_ALBUM",
    description: "Create a new album. Requires approval.",
    parameters: z.object({ title: z.string().describe("Album title") }).passthrough(),
    preview: (a) => ({
      title: "Create album",
      preview: `Create album "${String(a["title"] ?? "")}"`,
      confirmText: "Create album",
    }),
  },
  {
    slug: "GOOGLEPHOTOS_UPLOAD_MEDIA",
    description: "Upload a media file (image up to 200MB, video up to 20GB). Requires approval.",
    parameters: z.object({
      file_to_upload: z.string().describe("URL of the media file to upload"),
      description: z.string().optional().describe("Media item description"),
    }).passthrough(),
    fileParams: ["file_to_upload"],
    preview: () => ({
      title: "Upload media",
      preview: "Upload a file to Google Photos",
      confirmText: "Upload",
    }),
  },
  {
    slug: "GOOGLEPHOTOS_BATCH_ADD_MEDIA_ITEMS",
    description: "Add existing media items to an album. Requires approval.",
    parameters: z.object({
      albumId: z.string().describe("Album ID"),
      mediaItemIds: z.array(z.string()).describe("Media item IDs to add"),
    }).passthrough(),
    preview: (a) => ({
      title: "Add media to album",
      preview: `Add ${Array.isArray(a["mediaItemIds"]) ? (a["mediaItemIds"] as unknown[]).length : 0} item(s) to album ${String(a["albumId"] ?? "")}`,
      confirmText: "Add",
    }),
  },
  {
    slug: "GOOGLEPHOTOS_UPDATE_ALBUM",
    description: "Update an album's title or cover photo. Requires approval.",
    parameters: z.object({
      albumId: z.string().describe("Album ID"),
      title: z.string().optional().describe("New album title"),
    }).passthrough(),
    preview: (a) => ({
      title: "Update album",
      preview: `Update album ${String(a["albumId"] ?? "")}`,
      confirmText: "Update",
    }),
  },
]

export function makeComposioGooglePhotosDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-photos",
    name: "Google Photos",
    category: "file-management",
    icon: "google-photos",
    description: "Google Photos — browse albums and media, and upload/organize photos (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: GOOGLE_PHOTOS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GOOGLE_PHOTOS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Google Photos auth config in Composio (uses Google OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_GOOGLE_PHOTOS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-photos to route Google Photos through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_GOOGLE_PHOTOS_AUTH_CONFIG_ID", label: "Composio Google Photos auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googlephotos",
    },
    tools: createComposioTools({
      provider: "google-photos",
      toolkit: GOOGLE_PHOTOS_TOOLKIT,
      specs: googlePhotosComposioSpecs,
      executor,
    }),
  }
}
