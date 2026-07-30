import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const YOUTUBE_TOOLKIT = "youtube"

export const youtubeComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "YOUTUBE_SEARCH_YOU_TUBE",
    description: "Search YouTube for videos, channels, or playlists. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        type: z.string().optional().describe("'video', 'channel', or 'playlist'"),
        maxResults: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_VIDEO_DETAILS",
    description: "Get details of a video (snippet, statistics, content details). Read-only.",
    parameters: z
      .object({
        id: z.string().describe("Video ID"),
        part: z.string().optional().describe("Parts to include"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_GET_CHANNEL_STATISTICS",
    description: "Get subscriber/view/video counts for a channel. Read-only.",
    parameters: z.object({ id: z.string().describe("Channel ID") }).passthrough(),
  },
  {
    slug: "YOUTUBE_GET_CHANNEL_ACTIVITIES",
    description: "Get recent activity (uploads, likes) for a channel. Read-only.",
    parameters: z.object({ channelId: z.string().describe("Channel ID") }).passthrough(),
  },
  {
    slug: "YOUTUBE_GET_CHANNEL_ID_BY_HANDLE",
    description: "Resolve a channel handle (e.g. '@handle') to its channel ID. Read-only.",
    parameters: z.object({ channel_handle: z.string().describe("Channel handle") }).passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_CHANNEL_VIDEOS",
    description: "List videos from a specific channel. Read-only.",
    parameters: z
      .object({
        channelId: z.string().describe("Channel ID"),
        maxResults: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_USER_PLAYLISTS",
    description: "List the authenticated user's playlists. Read-only.",
    parameters: z
      .object({ maxResults: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
    description: "List the authenticated user's channel subscriptions. Read-only.",
    parameters: z
      .object({ maxResults: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_CAPTION_TRACK",
    description: "List caption tracks available for a video. Read-only.",
    parameters: z.object({ videoId: z.string().describe("Video ID") }).passthrough(),
  },
  {
    slug: "YOUTUBE_LOAD_CAPTIONS",
    description: "Download a caption track (must be owned by the authenticated user). Read-only.",
    parameters: z.object({ id: z.string().describe("Caption track ID") }).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "YOUTUBE_SUBSCRIBE_CHANNEL",
    description:
      "Subscribe the authenticated user to a channel. Requires user approval before it runs.",
    parameters: z
      .object({ channelId: z.string().describe("Channel ID to subscribe to") })
      .passthrough(),
    preview: (a) => ({
      title: "Subscribe to channel",
      preview: `Subscribe to ${String(a["channelId"] ?? "")}`,
      confirmText: "Subscribe",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_VIDEO",
    description:
      "Update metadata (title, description, tags) for a video. Requires user approval before it runs.",
    parameters: z
      .object({
        videoId: z.string().describe("Video ID"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update video",
      preview: `Update video ${String(a["videoId"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_THUMBNAIL",
    description:
      "Set a custom thumbnail for a video from an image URL. Requires user approval before it runs.",
    parameters: z
      .object({
        videoId: z.string().describe("Video ID"),
        thumbnailUrl: z.string().describe("Image URL"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update thumbnail",
      preview: `Update thumbnail for ${String(a["videoId"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "YOUTUBE_UPLOAD_VIDEO",
    description:
      "Upload a video from a local file path to a channel. Requires user approval before it runs.",
    parameters: z
      .object({
        videoFilePath: z.string().describe("Local path to the video file"),
        title: z.string().describe("Video title"),
        description: z.string().describe("Video description"),
        privacyStatus: z.string().describe("'public', 'private', or 'unlisted'"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Upload video",
      preview: `Upload "${String(a["title"] ?? "")}"`,
      confirmText: "Upload",
    }),
  },
]

export function makeComposioYouTubeDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "youtube",
    name: "YouTube",
    category: "communication",
    icon: "youtube",
    description:
      "Search, watch, manage playlists, upload videos, and view channel data (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: YOUTUBE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_YOUTUBE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a YouTube auth config in Composio (uses Google OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_YOUTUBE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=youtube to route YouTube through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_YOUTUBE_AUTH_CONFIG_ID",
          label: "Composio YouTube auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/youtube",
    },
    tools: createComposioTools({
      provider: "youtube",
      toolkit: YOUTUBE_TOOLKIT,
      specs: youtubeComposioSpecs,
      executor,
    }),
  }
}
