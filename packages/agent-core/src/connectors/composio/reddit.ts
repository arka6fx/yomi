import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const REDDIT_TOOLKIT = "reddit"

export const redditComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "REDDIT_RETRIEVE_REDDIT_POST", description: "Get hot posts from a subreddit. Read-only.", parameters: z.object({ subreddit: z.string().describe("Subreddit name"), size: z.number().int().optional().describe("Number of posts") }).passthrough() },
  { slug: "REDDIT_RETRIEVE_POST_COMMENTS", description: "Get all comments for a post. Read-only.", parameters: z.object({ article: z.string().describe("Post ID") }).passthrough() },
  { slug: "REDDIT_RETRIEVE_SPECIFIC_COMMENT", description: "Get details of a specific comment or post by its fullname. Read-only.", parameters: z.object({ id: z.string().describe("Comment/post fullname") }).passthrough() },
  { slug: "REDDIT_SEARCH_ACROSS_SUBREDDITS", description: "Search Reddit content by query. Read-only.", parameters: z.object({ search_query: z.string().describe("Search query"), sort: z.string().optional().describe("Sort order"), restrict_sr: z.boolean().optional().describe("Restrict to a specific subreddit") }).passthrough() },
  { slug: "REDDIT_GET_USER_FLAIR", description: "Get available post flairs for a subreddit. Read-only.", parameters: z.object({ subreddit: z.string().describe("Subreddit name") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "REDDIT_CREATE_REDDIT_POST",
    description: "Create a text or link post on a subreddit. Requires user approval before it runs.",
    parameters: z.object({ subreddit: z.string().describe("Subreddit name"), title: z.string().describe("Post title"), kind: z.string().describe("'self' for text or 'link'"), text: z.string().optional().describe("Post body (text posts)"), url: z.string().optional().describe("Link URL (link posts)") }).passthrough(),
    preview: (a) => ({ title: "Create post", preview: `Post "${String(a["title"] ?? "")}" to r/${String(a["subreddit"] ?? "")}`, confirmText: "Post" }),
  },
  {
    slug: "REDDIT_POST_REDDIT_COMMENT",
    description: "Post a comment replying to a post or comment. Requires user approval before it runs.",
    parameters: z.object({ thing_id: z.string().describe("Fullname of the post/comment to reply to"), text: z.string().describe("Comment text") }).passthrough(),
    preview: (a) => ({ title: "Post comment", preview: String(a["text"] ?? "").slice(0, 100), confirmText: "Comment" }),
  },
  {
    slug: "REDDIT_EDIT_REDDIT_COMMENT_OR_POST",
    description: "Edit the body text of your own comment or self-post. Requires user approval before it runs.",
    parameters: z.object({ thing_id: z.string().describe("Fullname of the comment/post"), text: z.string().describe("New text") }).passthrough(),
    preview: (a) => ({ title: "Edit content", preview: `Edit ${String(a["thing_id"] ?? "")}`, confirmText: "Edit" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "REDDIT_DELETE_REDDIT_POST",
    description: "Permanently delete a post. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Post fullname") }).passthrough(),
    preview: (a) => ({ title: "Delete post", preview: `Delete post ${String(a["id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "REDDIT_DELETE_REDDIT_COMMENT",
    description: "Permanently delete a comment. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Comment fullname") }).passthrough(),
    preview: (a) => ({ title: "Delete comment", preview: `Delete comment ${String(a["id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioRedditDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "reddit",
    name: "Reddit",
    category: "communication",
    icon: "reddit",
    description: "Reddit — browse posts and comments, search, and post/comment on subreddits (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: REDDIT_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_REDDIT_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Reddit auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_REDDIT_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=reddit to route Reddit through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_REDDIT_AUTH_CONFIG_ID", label: "Composio Reddit auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/reddit",
    },
    tools: createComposioTools({
      provider: "reddit",
      toolkit: REDDIT_TOOLKIT,
      specs: redditComposioSpecs,
      executor,
    }),
  }
}
