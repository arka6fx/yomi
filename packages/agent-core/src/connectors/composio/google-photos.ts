import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

// Composio's real toolkit slug is "googlephotos" (no underscore) — verified
// against the live auth-configs/tools catalog, not "google_photos".
export const GOOGLE_PHOTOS_TOOLKIT = "googlephotos"

// Google restricted the Photos Library API's broad photoslibrary.readonly scope in
// 2025 to apps with a verification tier Yomi doesn't have — confirmed live, the
// granted scope is photoslibrary.readonly.appcreateddata / .edit.appcreateddata
// only. Every read action below can only see albums/media Yomi itself created or
// uploaded — never the user's actual existing library. That has to be in the
// description itself, not just a code comment, or the model promises "arrange
// your photos by event" and then has nothing to show for it.
const APP_CREATED_ONLY =
  " Limitation: Yomi can only see photos/albums Yomi itself uploaded or created — Google restricts broader library access. It cannot browse, list, or search the user's existing Google Photos library."

export const googlePhotosComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLEPHOTOS_LIST_ALBUMS",
    description: `List Google Photos albums.${APP_CREATED_ONLY} Read-only.`,
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Max results per page"),
        pageToken: z.string().optional().describe("Pagination token"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_GET_ALBUM",
    description: `Get details of a specific album.${APP_CREATED_ONLY} Read-only.`,
    parameters: z.object({ albumId: z.string().describe("Google Photos album ID") }).passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_LIST_MEDIA_ITEMS",
    description: `List media items.${APP_CREATED_ONLY} Read-only.`,
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Max results per page"),
        pageToken: z.string().optional().describe("Pagination token"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_SEARCH_MEDIA_ITEMS",
    description: `Search media items by album or filters.${APP_CREATED_ONLY} Read-only.`,
    parameters: z
      .object({
        albumId: z.string().optional().describe("Restrict search to this album"),
        pageSize: z.number().int().optional().describe("Max results per page"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_BATCH_GET_MEDIA_ITEMS",
    description: `Get details for a batch of media items by ID.${APP_CREATED_ONLY} Read-only.`,
    parameters: z
      .object({ mediaItemIds: z.array(z.string()).describe("Media item IDs") })
      .passthrough(),
  },
  {
    slug: "GOOGLEPHOTOS_GET_MEDIA_ITEM_DOWNLOAD",
    description: "Download a media item's file content. Read-only.",
    parameters: z
      .object({ mediaItemId: z.string().describe("Google Photos media item ID") })
      .passthrough(),
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
    parameters: z
      .object({
        file_to_upload: z.string().describe("URL of the media file to upload"),
        description: z.string().optional().describe("Media item description"),
      })
      .passthrough(),
    fileParams: ["file_to_upload"],
    preview: () => ({
      title: "Upload media",
      preview: "Upload a file to Google Photos",
      confirmText: "Upload",
    }),
  },
  {
    slug: "GOOGLEPHOTOS_BATCH_CREATE_MEDIA_ITEMS",
    description:
      "Upload up to 50 media files from public URLs, optionally straight into an album. Prefer this over GOOGLEPHOTOS_UPLOAD_MEDIA whenever the target album is known — upload_media has no albumId, so it needs a second approval-gated batch_add_media_items call to place the file. Requires approval.",
    // No fileParams: `urls` is Composio's "simplified input" — it fetches each URL
    // server-side, so staging the bytes through stageFile() would be a pointless
    // download-and-reupload round trip.
    parameters: z
      .object({
        urls: z
          .array(z.string())
          .max(50)
          .describe("Public URLs of the media files to upload (max 50)"),
        albumId: z
          .string()
          .optional()
          .describe("Album to add the items to; omit to add to the library only"),
      })
      .passthrough(),
    preview: (a) => {
      const count = Array.isArray(a["urls"]) ? (a["urls"] as unknown[]).length : 0
      const album = a["albumId"] ? ` into album ${String(a["albumId"])}` : ""
      return {
        title: "Upload media",
        preview: `Upload ${count} file(s) to Google Photos${album}`,
        confirmText: "Upload",
      }
    },
  },
  {
    slug: "GOOGLEPHOTOS_BATCH_ADD_MEDIA_ITEMS",
    description: "Add existing media items to an album. Requires approval.",
    parameters: z
      .object({
        albumId: z.string().describe("Album ID"),
        mediaItemIds: z.array(z.string()).describe("Media item IDs to add"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add media to album",
      preview: `Add ${Array.isArray(a["mediaItemIds"]) ? (a["mediaItemIds"] as unknown[]).length : 0} item(s) to album ${String(a["albumId"] ?? "")}`,
      confirmText: "Add",
    }),
  },
  {
    slug: "GOOGLEPHOTOS_UPDATE_ALBUM",
    description: "Update an album's title or cover photo. Requires approval.",
    parameters: z
      .object({
        albumId: z.string().describe("Album ID"),
        title: z.string().optional().describe("New album title"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update album",
      preview: `Update album ${String(a["albumId"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "GOOGLEPHOTOS_UPDATE_MEDIA_ITEM",
    description:
      "Replace a media item's description (max 1000 characters). Only works on media Yomi itself uploaded, since that's the only media it can obtain an ID for. Requires approval.",
    parameters: z
      .object({
        mediaItemId: z.string().describe("Google Photos media item ID"),
        description: z
          .string()
          .max(1000)
          .describe("New description, replacing the existing one; under 1000 characters"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update media description",
      preview: `Set description of ${String(a["mediaItemId"] ?? "")} to "${String(a["description"] ?? "").slice(0, 120)}"`,
      confirmText: "Update",
    }),
  },
  {
    slug: "GOOGLEPHOTOS_ADD_ENRICHMENT",
    description:
      "Add a text, location, or map caption block to an album at a chosen position. Exactly one of textEnrichment / locationEnrichment / mapEnrichment must be set. Requires approval.",
    parameters: z
      .object({
        albumId: z.string().describe("Album to add the enrichment to"),
        albumPosition: z
          .object({
            position: z
              .enum(["FIRST_IN_ALBUM", "LAST_IN_ALBUM", "AFTER_MEDIA_ITEM", "AFTER_ENRICHMENT_ITEM"])
              .describe("Where in the album to place the enrichment"),
            relativeMediaItemId: z.string().optional().describe("Required for AFTER_MEDIA_ITEM"),
            relativeEnrichmentItemId: z
              .string()
              .optional()
              .describe("Required for AFTER_ENRICHMENT_ITEM"),
          })
          .passthrough(),
        // Composio documents the three enrichment kinds but not their inner shapes,
        // so these stay permissive and mirror Google's own field names.
        newEnrichmentItem: z
          .object({
            textEnrichment: z
              .object({ text: z.string().describe("Caption text") })
              .passthrough()
              .optional(),
            locationEnrichment: z
              .object({})
              .passthrough()
              .optional()
              .describe("{ location: { locationName, latlng: { latitude, longitude } } }"),
            mapEnrichment: z
              .object({})
              .passthrough()
              .optional()
              .describe("{ origin: { location }, destination: { location } }"),
          })
          .passthrough(),
      })
      .passthrough(),
    preview: (a) => {
      const item = (a["newEnrichmentItem"] ?? {}) as Record<string, unknown>
      const kind = item["textEnrichment"]
        ? "text"
        : item["locationEnrichment"]
          ? "location"
          : item["mapEnrichment"]
            ? "map"
            : "unknown"
      const pos = (a["albumPosition"] as Record<string, unknown> | undefined)?.["position"]
      return {
        title: "Add album enrichment",
        preview: `Add a ${kind} enrichment to album ${String(a["albumId"] ?? "")} at ${String(pos ?? "unspecified position")}`,
        confirmText: "Add",
      }
    },
  },
]

export function makeComposioGooglePhotosDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-photos",
    name: "Google Photos",
    category: "file-management",
    icon: "google-photos",
    description:
      "Google Photos — upload and organize photos Yomi itself creates (via Composio). Cannot browse or search the user's existing library — Google restricts that scope.",
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
        {
          env: "COMPOSIO_GOOGLE_PHOTOS_AUTH_CONFIG_ID",
          label: "Composio Google Photos auth config id",
          secret: false,
        },
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
