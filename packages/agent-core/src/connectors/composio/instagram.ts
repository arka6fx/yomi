import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const INSTAGRAM_TOOLKIT = "instagram"

export const instagramComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "INSTAGRAM_GET_USER_INFO", description: "Get Instagram profile details and statistics. Read-only.", parameters: z.object({ ig_user_id: z.string().optional().describe("Instagram business account ID") }).passthrough() },
  { slug: "INSTAGRAM_GET_USER_MEDIA", description: "Get the user's media (posts, photos, videos). Read-only.", parameters: z.object({ ig_user_id: z.string().optional().describe("Instagram business account ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "INSTAGRAM_GET_USER_INSIGHTS", description: "Get account-level insights (profile views, reach, impressions). Read-only.", parameters: z.object({ ig_user_id: z.string().optional().describe("Instagram business account ID"), metric: z.array(z.string()).describe("Metrics to fetch"), period: z.string().optional().describe("Aggregation period") }).passthrough() },
  { slug: "INSTAGRAM_GET_POST_COMMENTS", description: "Get comments on a post. Read-only.", parameters: z.object({ ig_post_id: z.string().describe("Post ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "INSTAGRAM_GET_POST_INSIGHTS", description: "Get insights/analytics for a post (impressions, reach, engagement). Read-only.", parameters: z.object({ ig_post_id: z.string().describe("Post ID"), metric: z.array(z.string()).optional().describe("Metrics to fetch") }).passthrough() },
  { slug: "INSTAGRAM_GET_POST_STATUS", description: "Check the processing status of a draft post container. Read-only.", parameters: z.object({ creation_id: z.string().describe("Media container creation ID") }).passthrough() },
  { slug: "INSTAGRAM_GET_CONVERSATION", description: "Get details of a specific DM conversation. Read-only.", parameters: z.object({ conversation_id: z.string().describe("Conversation ID") }).passthrough() },
  { slug: "INSTAGRAM_LIST_ALL_CONVERSATIONS", description: "List all DM conversations. Read-only.", parameters: z.object({ ig_user_id: z.string().optional().describe("Instagram business account ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "INSTAGRAM_LIST_ALL_MESSAGES", description: "List messages in a DM conversation. Read-only.", parameters: z.object({ conversation_id: z.string().describe("Conversation ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  // ig_user_id is auto-filled from INSTAGRAM_GET_USER_INFO right before each
  // call runs (see `resolvedParams` below) — the model has no way to know the
  // real Instagram Business Account ID, and a guessed value fails with a
  // confusing Graph API error instead of a clean one. Kept optional/described
  // in the schema only so a model that fills it in anyway doesn't hard-fail
  // validation; the resolved value always wins.
  {
    slug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    description: "Create a draft media container for a photo/video/reel before publishing. Requires user approval before it runs.",
    parameters: z.object({ ig_user_id: z.string().optional().describe("Instagram business account ID (auto-filled, leave blank)"), image_url: z.string().optional().describe("Image URL"), video_url: z.string().optional().describe("Video URL"), caption: z.string().optional().describe("Caption") }).passthrough(),
    resolvedParams: { ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } },
    preview: (a) => ({ title: "Create media container", preview: String(a["caption"] ?? "New media").slice(0, 100), confirmText: "Create" }),
  },
  {
    slug: "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
    description: "Create a draft carousel post with multiple images/videos. Requires user approval before it runs.",
    parameters: z.object({ ig_user_id: z.string().optional().describe("Instagram business account ID (auto-filled, leave blank)"), children: z.array(z.string()).describe("Media container IDs"), caption: z.string().optional().describe("Caption") }).passthrough(),
    resolvedParams: { ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } },
    preview: (a) => ({ title: "Create carousel", preview: String(a["caption"] ?? "New carousel").slice(0, 100), confirmText: "Create" }),
  },
  {
    slug: "INSTAGRAM_CREATE_POST",
    description: "Publish a draft media container to Instagram (final publishing step). Requires user approval before it runs.",
    parameters: z.object({ ig_user_id: z.string().optional().describe("Instagram business account ID (auto-filled, leave blank)"), creation_id: z.string().describe("Media container ID to publish") }).passthrough(),
    resolvedParams: { ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } },
    preview: (a) => ({ title: "Publish post", preview: `Publish container ${String(a["creation_id"] ?? "")}`, confirmText: "Publish" }),
  },
  {
    slug: "INSTAGRAM_REPLY_TO_COMMENT",
    description: "Reply to a comment on a post. Requires user approval before it runs.",
    parameters: z.object({ ig_comment_id: z.string().describe("Comment ID"), message: z.string().describe("Reply text") }).passthrough(),
    preview: (a) => ({ title: "Reply to comment", preview: String(a["message"] ?? "").slice(0, 100), confirmText: "Reply" }),
  },
  {
    slug: "INSTAGRAM_SEND_TEXT_MESSAGE",
    description: "Send a text DM to a user. Requires user approval before it runs.",
    parameters: z.object({ recipient_id: z.string().describe("Recipient user ID"), text: z.string().describe("Message text") }).passthrough(),
    preview: (a) => ({ title: "Send DM", preview: String(a["text"] ?? "").slice(0, 100), confirmText: "Send" }),
  },
  {
    slug: "INSTAGRAM_SEND_IMAGE",
    description: "Send an image via DM to a user. Requires user approval before it runs.",
    parameters: z.object({ recipient_id: z.string().describe("Recipient user ID"), image_url: z.string().describe("Image URL") }).passthrough(),
    preview: (a) => ({ title: "Send image DM", preview: `Send image to ${String(a["recipient_id"] ?? "")}`, confirmText: "Send" }),
  },
  {
    slug: "INSTAGRAM_MARK_SEEN",
    description: "Mark DM messages as read for a user. Requires user approval before it runs.",
    parameters: z.object({ recipient_id: z.string().describe("Recipient user ID") }).passthrough(),
    preview: (a) => ({ title: "Mark as seen", preview: `Mark messages seen for ${String(a["recipient_id"] ?? "")}`, confirmText: "Mark seen" }),
  },
]

export function makeComposioInstagramDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "instagram",
    name: "Instagram",
    category: "communication",
    icon: "instagram",
    description: "Instagram — post photos/videos/carousels, reply to comments, and manage DMs (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: INSTAGRAM_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create an Instagram auth config in Composio (uses Meta OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=instagram to route Instagram through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID", label: "Composio Instagram auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/instagram",
    },
    tools: createComposioTools({
      provider: "instagram",
      toolkit: INSTAGRAM_TOOLKIT,
      specs: instagramComposioSpecs,
      executor,
    }),
  }
}
