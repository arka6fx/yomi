import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const REDDIT_TOOLKIT = "reddit"

export const redditComposioSpecs: ComposioToolSpec[] = [
  // ── Read / Search actions ─────────────────────────────────────
  {
    slug: "REDDIT_RETRIEVE_REDDIT_POST",
    description:
      "Retrieve posts from a specified, publicly accessible subreddit. Paginated. Read-only.",
    parameters: z
      .object({
        subreddit: z.string().describe("Subreddit name (without r/)"),
        sort: z.string().optional().describe("Sort order: 'hot', 'new', 'top', 'rising', 'controversial'"),
        limit: z.number().int().optional().describe("Max results (default 25)"),
        after: z.string().optional().describe("Pagination cursor from previous response"),
        time_filter: z.string().optional().describe("Time filter: 'hour', 'day', 'week', 'month', 'year', 'all'"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_SEARCH_ACROSS_SUBREDDITS",
    description:
      "Search Reddit for posts matching a query. Paginated. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        sort: z.string().optional().describe("Sort order: 'relevance', 'hot', 'top', 'new', 'comments'"),
        limit: z.number().int().optional().describe("Max results (default 25)"),
        after: z.string().optional().describe("Pagination cursor"),
        subreddit: z.string().optional().describe("Restrict search to a specific subreddit"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_SUBREDDITS_SEARCH",
    description:
      "Search for subreddits by title and description. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query for subreddit name or topic"),
        limit: z.number().int().optional().describe("Max results"),
        after: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_RETRIEVE_POST_COMMENTS",
    description:
      "Get all comments for a Reddit post by its base-36 ID. Supports nested replies. Read-only.",
    parameters: z
      .object({
        article_id: z.string().describe("Base-36 article/post ID"),
        limit: z.number().int().optional().describe("Max comments to return"),
        depth: z.number().int().optional().describe("Max comment nesting depth"),
        sort: z.string().optional().describe("Sort: 'best', 'top', 'new', 'controversial', 'old', 'q&a'"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET",
    description:
      "Get a listing of Reddit posts sorted by criteria (hot, new, top, etc.). Read-only.",
    parameters: z
      .object({
        sort: z.string().optional().describe("Sort: 'hot', 'new', 'top', 'controversial', 'rising'"),
        limit: z.number().int().optional().describe("Max results"),
        after: z.string().optional().describe("Pagination cursor"),
        time_filter: z.string().optional().describe("Time filter for top/controversial: 'hour', 'day', 'week', 'month', 'year', 'all'"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_R_TOP",
    description:
      "Get top-rated posts from a subreddit with time filters. Read-only.",
    parameters: z
      .object({
        subreddit: z.string().describe("Subreddit name (without r/)"),
        time_filter: z.string().optional().describe("'hour', 'day', 'week', 'month', 'year', 'all'"),
        limit: z.number().int().optional().describe("Max results"),
        after: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_CONTROVERSIAL_POSTS",
    description:
      "Get controversial posts from all subreddits with time filters. Read-only.",
    parameters: z
      .object({
        time_filter: z.string().optional().describe("'hour', 'day', 'week', 'month', 'year', 'all'"),
        limit: z.number().int().optional().describe("Max results"),
        after: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_RANDOM",
    description:
      "Get a random public Reddit post from any subreddit. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "REDDIT_GET_REDDIT_USER_ABOUT",
    description:
      "Get information about a Reddit user including karma scores. Read-only.",
    parameters: z
      .object({
        username: z.string().describe("Reddit username"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_SUBREDDIT_RULES",
    description:
      "Fetch the posting rules for a subreddit. Read-only.",
    parameters: z
      .object({
        subreddit: z.string().describe("Subreddit name (without r/)"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_ME_PREFS",
    description:
      "Get preference settings of the logged in user. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "REDDIT_RETRIEVE_SPECIFIC_COMMENT",
    description:
      "Get detailed info for a single Reddit comment or post by its fullname ID. Read-only.",
    parameters: z
      .object({
        fullname: z.string().describe("Fullname ID (e.g. 't1_abc123' for comment, 't3_abc123' for post)"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_LIST_SUBREDDIT_POST_FLAIRS",
    description:
      "List available post flairs for a subreddit. Read-only.",
    parameters: z
      .object({
        subreddit: z.string().describe("Subreddit name (without r/)"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_USER_FLAIR",
    description:
      "Get user flair assignments for a subreddit. Read-only.",
    parameters: z
      .object({
        subreddit: z.string().describe("Subreddit name"),
        limit: z.number().int().optional().describe("Max results"),
        after: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_USERNAME_AVAILABLE",
    description:
      "Check whether a username is available for registration on Reddit. Read-only.",
    parameters: z
      .object({
        username: z.string().describe("Username to check"),
      })
      .passthrough(),
  },
  {
    slug: "REDDIT_GET_SCOPES",
    description:
      "Get all available OAuth scopes supported by the Reddit API. Read-only.",
    parameters: z.object({}).passthrough(),
  },

  // ── Write / Execute actions (gated) ───────────────────────────
  {
    slug: "REDDIT_CREATE_REDDIT_POST",
    description:
      "Create a text or link post on a subreddit, optionally with a flair. Published publicly and immediately. Requires user approval before it runs.",
    parameters: z
      .object({
        subreddit: z.string().describe("Subreddit name (without r/)"),
        title: z.string().describe("Post title"),
        content: z.string().optional().describe("Post body text (for text/self posts)"),
        url: z.string().optional().describe("URL (for link posts)"),
        flair_id: z.string().optional().describe("Flair template ID from LIST_SUBREDDIT_POST_FLAIRS"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Post to r/${String(a["subreddit"] ?? "")}`,
      preview: `Create post "${String(a["title"] ?? "").slice(0, 80)}" in r/${String(a["subreddit"] ?? "")}`,
      confirmText: "Create post",
    }),
  },
  {
    slug: "REDDIT_POST_REDDIT_COMMENT",
    description:
      "Post a comment on a Reddit submission or as a reply to another comment. Published publicly and immediately. Requires user approval before it runs.",
    parameters: z
      .object({
        post_id: z.string().describe("Post or comment fullname ID to reply to (e.g. 't3_abc123' or 't1_abc123')"),
        text: z.string().describe("Comment body text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Post comment",
      preview: `Comment on ${String(a["post_id"] ?? "").slice(0, 20)}`,
      confirmText: "Post comment",
    }),
  },
  {
    slug: "REDDIT_EDIT_REDDIT_COMMENT_OR_POST",
    description:
      "Edit the body text of your own existing comment or self-post. Cannot edit link posts or titles. Requires user approval before it runs.",
    parameters: z
      .object({
        fullname: z.string().describe("Fullname ID of your comment or post to edit (e.g. 't1_abc123')"),
        text: z.string().describe("New body text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Edit content",
      preview: `Edit ${String(a["fullname"] ?? "").slice(0, 20)}`,
      confirmText: "Edit",
    }),
  },
  {
    slug: "REDDIT_TOGGLE_INBOX_REPLIES",
    description:
      "Enable or disable inbox notifications for replies to your post or comment. Requires user approval before it runs.",
    parameters: z
      .object({
        fullname: z.string().describe("Fullname ID of your post or comment"),
        state: z.coerce.boolean().describe("True to enable replies, false to disable"),
      })
      .passthrough(),
    preview: (a) => ({
      title: a["state"] ? "Enable inbox replies" : "Disable inbox replies",
      preview: `${a["state"] ? "Enable" : "Disable"} inbox replies for ${String(a["fullname"] ?? "").slice(0, 20)}`,
      confirmText: a["state"] ? "Enable" : "Disable",
    }),
  },

  // ── Irreversible actions (gated, flagged) ────────────────────
  {
    slug: "REDDIT_DELETE_REDDIT_POST",
    description:
      "Permanently and irreversibly delete a Reddit post by its ID. Only works on your own posts. This action is irreversible.",
    parameters: z
      .object({
        post_id: z.string().describe("Post ID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete post",
      preview: `Permanently delete post ${String(a["post_id"] ?? "")}`,
      confirmText: "Delete post",
    }),
  },
  {
    slug: "REDDIT_DELETE_REDDIT_COMMENT",
    description:
      "Permanently and irreversibly delete your own Reddit comment. This action is irreversible.",
    parameters: z
      .object({
        comment_id: z.string().describe("Comment fullname ID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete comment",
      preview: `Permanently delete comment ${String(a["comment_id"] ?? "").slice(0, 20)}`,
      confirmText: "Delete comment",
    }),
  },
]

export function makeComposioRedditDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "reddit",
    name: "Reddit",
    category: "communication",
    icon: "reddit",
    description: "Browse subreddits, search posts, manage comments and posts on Reddit (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: REDDIT_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_REDDIT_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Reddit auth config in Composio (uses OAuth2 — no manual API key needed)",
        "Set COMPOSIO_API_KEY and COMPOSIO_REDDIT_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=reddit to route Reddit through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_REDDIT_AUTH_CONFIG_ID", label: "Composio Reddit auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/reddit",
    },
    tools: createComposioTools({
      provider: "reddit",
      toolkit: REDDIT_TOOLKIT,
      specs: redditComposioSpecs,
      executor,
    }),
  }
}
