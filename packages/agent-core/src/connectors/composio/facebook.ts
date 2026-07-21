import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const FACEBOOK_TOOLKIT = "facebook"

export const facebookComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "FACEBOOK_GET_USER_PAGES", description: "List pages the user manages. Read-only.", parameters: z.object({ user_id: z.string().optional().describe("User ID (defaults to authenticated user)") }).passthrough() },
  { slug: "FACEBOOK_GET_PAGE_DETAILS", description: "Get details of a specific page. Read-only.", parameters: z.object({ page_id: z.string().describe("Page ID") }).passthrough() },
  { slug: "FACEBOOK_GET_PAGE_POSTS", description: "List posts from a page. Read-only.", parameters: z.object({ page_id: z.string().describe("Page ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "FACEBOOK_GET_POST", description: "Get details of a specific post. Read-only.", parameters: z.object({ post_id: z.string().describe("Post ID") }).passthrough() },
  { slug: "FACEBOOK_GET_POST_INSIGHTS", description: "Get analytics/insights for a post. Read-only.", parameters: z.object({ post_id: z.string().describe("Post ID"), metrics: z.string().optional().describe("Metrics to fetch") }).passthrough() },
  { slug: "FACEBOOK_GET_POST_REACTIONS", description: "Get reactions on a post. Read-only.", parameters: z.object({ post_id: z.string().describe("Post ID") }).passthrough() },
  { slug: "FACEBOOK_GET_COMMENTS", description: "Get comments on a post or comment. Read-only.", parameters: z.object({ object_id: z.string().describe("Post or comment ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "FACEBOOK_GET_COMMENT", description: "Get details of a specific comment. Read-only.", parameters: z.object({ comment_id: z.string().describe("Comment ID") }).passthrough() },
  { slug: "FACEBOOK_GET_PAGE_INSIGHTS", description: "Get analytics/insights for a page. Read-only.", parameters: z.object({ page_id: z.string().describe("Page ID"), metrics: z.string().optional().describe("Metrics to fetch"), period: z.string().optional().describe("Aggregation period") }).passthrough() },
  { slug: "FACEBOOK_GET_PAGE_PHOTOS", description: "List photos from a page. Read-only.", parameters: z.object({ page_id: z.string().describe("Page ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "FACEBOOK_GET_PAGE_VIDEOS", description: "List videos from a page. Read-only.", parameters: z.object({ page_id: z.string().describe("Page ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "FACEBOOK_GET_PAGE_ROLES", description: "List people and their roles on a page. Read-only.", parameters: z.object({ page_id: z.string().describe("Page ID") }).passthrough() },
  { slug: "FACEBOOK_GET_SCHEDULED_POSTS", description: "List scheduled/unpublished posts for a page. Read-only.", parameters: z.object({ page_id: z.string().describe("Page ID") }).passthrough() },
  { slug: "FACEBOOK_GET_PAGE_CONVERSATIONS", description: "List Messenger conversations for a page. Read-only.", parameters: z.object({ page_id: z.string().describe("Page ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "FACEBOOK_GET_CONVERSATION_MESSAGES", description: "Get messages in a conversation. Read-only.", parameters: z.object({ conversation_id: z.string().describe("Conversation ID") }).passthrough() },
  { slug: "FACEBOOK_GET_MESSAGE_DETAILS", description: "Get details of a specific message. Read-only.", parameters: z.object({ message_id: z.string().describe("Message ID") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "FACEBOOK_CREATE_POST",
    description: "Create a new post on a page. Requires user approval before it runs.",
    parameters: z.object({ page_id: z.string().describe("Page ID"), message: z.string().describe("Post text"), link: z.string().optional().describe("Link to attach") }).passthrough(),
    preview: (a) => ({ title: "Create post", preview: String(a["message"] ?? "").slice(0, 100), confirmText: "Post" }),
  },
  {
    slug: "FACEBOOK_UPDATE_POST",
    description: "Update an existing page post. Requires user approval before it runs.",
    parameters: z.object({ post_id: z.string().describe("Post ID"), message: z.string().optional().describe("New post text") }).passthrough(),
    preview: (a) => ({ title: "Update post", preview: `Update post ${String(a["post_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "FACEBOOK_CREATE_PHOTO_POST",
    description: "Create a photo post on a page. Requires user approval before it runs.",
    parameters: z.object({ page_id: z.string().describe("Page ID"), url: z.string().optional().describe("Photo URL"), message: z.string().optional().describe("Caption") }).passthrough(),
    preview: (a) => ({ title: "Create photo post", preview: String(a["message"] ?? "New photo post").slice(0, 100), confirmText: "Post" }),
  },
  {
    slug: "FACEBOOK_CREATE_VIDEO_POST",
    description: "Create a video post on a page. Requires user approval before it runs.",
    parameters: z.object({ page_id: z.string().describe("Page ID"), file_url: z.string().optional().describe("Video URL"), description: z.string().optional().describe("Caption") }).passthrough(),
    preview: (a) => ({ title: "Create video post", preview: String(a["description"] ?? "New video post").slice(0, 100), confirmText: "Post" }),
  },
  {
    slug: "FACEBOOK_CREATE_COMMENT",
    description: "Create a comment on a post, or reply to a comment. Requires user approval before it runs.",
    parameters: z.object({ object_id: z.string().describe("Post or comment ID"), message: z.string().describe("Comment text") }).passthrough(),
    preview: (a) => ({ title: "Create comment", preview: String(a["message"] ?? "").slice(0, 100), confirmText: "Comment" }),
  },
  {
    slug: "FACEBOOK_LIKE_POST_OR_COMMENT",
    description: "Like a post or comment. Requires user approval before it runs.",
    parameters: z.object({ object_id: z.string().describe("Post or comment ID") }).passthrough(),
    preview: (a) => ({ title: "Like", preview: `Like ${String(a["object_id"] ?? "")}`, confirmText: "Like" }),
  },
  {
    slug: "FACEBOOK_ADD_REACTION",
    description: "Add a reaction (like, love, wow, etc.) to a post or comment. Requires user approval before it runs.",
    parameters: z.object({ object_id: z.string().describe("Post or comment ID"), type: z.string().optional().describe("Reaction type") }).passthrough(),
    preview: (a) => ({ title: "Add reaction", preview: `React to ${String(a["object_id"] ?? "")}`, confirmText: "React" }),
  },
  {
    slug: "FACEBOOK_SEND_MESSAGE",
    description: "Send a text message from the page to a user via Messenger. Requires user approval before it runs.",
    parameters: z.object({ page_id: z.string().describe("Page ID"), recipient_id: z.string().describe("Recipient user ID"), message_text: z.string().describe("Message text") }).passthrough(),
    preview: (a) => ({ title: "Send message", preview: String(a["message_text"] ?? "").slice(0, 100), confirmText: "Send" }),
  },
  {
    slug: "FACEBOOK_PUBLISH_SCHEDULED_POST",
    description: "Publish a scheduled/unpublished post immediately. Requires user approval before it runs.",
    parameters: z.object({ post_id: z.string().describe("Post ID") }).passthrough(),
    preview: (a) => ({ title: "Publish post", preview: `Publish post ${String(a["post_id"] ?? "")}`, confirmText: "Publish" }),
  },
  {
    slug: "FACEBOOK_RESCHEDULE_POST",
    description: "Change the scheduled publish time of an unpublished post. Requires user approval before it runs.",
    parameters: z.object({ post_id: z.string().describe("Post ID"), scheduled_publish_time: z.number().int().describe("New scheduled time (Unix timestamp)") }).passthrough(),
    preview: (a) => ({ title: "Reschedule post", preview: `Reschedule post ${String(a["post_id"] ?? "")}`, confirmText: "Reschedule" }),
  },
  {
    slug: "FACEBOOK_UPDATE_PAGE_SETTINGS",
    description: "Update a page's settings (about, phone, website, etc.). Requires user approval before it runs.",
    parameters: z.object({ page_id: z.string().describe("Page ID") }).passthrough(),
    preview: (a) => ({ title: "Update page settings", preview: `Update page ${String(a["page_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "FACEBOOK_ASSIGN_PAGE_TASK",
    description: "Assign tasks/roles to a user for a page. Requires user approval before it runs.",
    parameters: z.object({ page_id: z.string().describe("Page ID"), user: z.string().describe("User ID"), tasks: z.array(z.string()).describe("Tasks to assign") }).passthrough(),
    preview: (a) => ({ title: "Assign page task", preview: `Assign tasks to ${String(a["user"] ?? "")}`, confirmText: "Assign" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "FACEBOOK_DELETE_POST",
    description: "Permanently delete a page post. This cannot be undone.",
    parameters: z.object({ post_id: z.string().describe("Post ID") }).passthrough(),
    preview: (a) => ({ title: "Delete post", preview: `Delete post ${String(a["post_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "FACEBOOK_DELETE_COMMENT",
    description: "Permanently delete a comment. This cannot be undone.",
    parameters: z.object({ comment_id: z.string().describe("Comment ID") }).passthrough(),
    preview: (a) => ({ title: "Delete comment", preview: `Delete comment ${String(a["comment_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "FACEBOOK_UNLIKE_POST_OR_COMMENT",
    description: "Remove a like from a post or comment. This cannot be undone.",
    parameters: z.object({ object_id: z.string().describe("Post or comment ID") }).passthrough(),
    preview: (a) => ({ title: "Unlike", preview: `Unlike ${String(a["object_id"] ?? "")}`, confirmText: "Unlike" }),
  },
  {
    slug: "FACEBOOK_REMOVE_PAGE_TASK",
    description: "Remove a user's access/tasks from a page. This cannot be undone.",
    parameters: z.object({ page_id: z.string().describe("Page ID"), user: z.string().describe("User ID") }).passthrough(),
    preview: (a) => ({ title: "Remove page access", preview: `Remove ${String(a["user"] ?? "")} from page ${String(a["page_id"] ?? "")}`, confirmText: "Remove" }),
  },
]

export function makeComposioFacebookDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "facebook",
    name: "Facebook",
    category: "communication",
    icon: "facebook",
    description: "Facebook — manage pages, posts, comments, insights, and Messenger conversations (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: FACEBOOK_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_FACEBOOK_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Facebook auth config in Composio (uses Meta OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_FACEBOOK_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=facebook to route Facebook through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_FACEBOOK_AUTH_CONFIG_ID", label: "Composio Facebook auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/facebook",
    },
    tools: createComposioTools({
      provider: "facebook",
      toolkit: FACEBOOK_TOOLKIT,
      specs: facebookComposioSpecs,
      executor,
    }),
  }
}
