import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const LINKEDIN_TOOLKIT = "linkedin"

export const linkedinComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "LINKEDIN_GET_MY_INFO",
    description:
      "Fetch the authenticated LinkedIn user's profile info (name, headline, photo, etc.). Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "LINKEDIN_GET_PERSON",
    description:
      "Retrieve a LinkedIn member's profile information by person ID. Read-only.",
    parameters: z
      .object({
        person_id: z.string().describe("LinkedIn person ID to look up"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_GET_COMPANY_INFO",
    description:
      "Get organizations where the authenticated user has roles (ACLs). Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "LINKEDIN_GET_POST_CONTENT",
    description:
      "Retrieve detailed post content (text, images, videos, metadata) by post URN. Read-only.",
    parameters: z
      .object({
        post_urn: z.string().describe("LinkedIn post URN to fetch content for"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_GET_SHARE_STATS",
    description:
      "Get share statistics (impressions, clicks, likes, comments) for an organization. Read-only.",
    parameters: z
      .object({
        share_id: z.string().describe("Share ID for the LinkedIn post"),
        organization_id: z.string().describe("Organization ID on LinkedIn"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_GET_ORG_PAGE_STATS",
    description:
      "Get page statistics (views, button clicks) for a LinkedIn organization page. Read-only.",
    parameters: z
      .object({
        organization_id: z.string().describe("Organization ID"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_GET_NETWORK_SIZE",
    description:
      "Get follower count for a LinkedIn organization. Read-only.",
    parameters: z
      .object({
        organization_id: z.string().describe("Organization ID"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_GET_IMAGE",
    description:
      "Get details of a LinkedIn image by its URN (status, download URL, metadata). Read-only.",
    parameters: z
      .object({
        image_urn: z.string().describe("LinkedIn image URN"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_GET_IMAGES",
    description:
      "Retrieve image metadata (download URLs, status, dimensions) from LinkedIn. Read-only.",
    parameters: z
      .object({
        image_urns: z.string().describe("Comma-separated LinkedIn image URNs"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_GET_VIDEOS",
    description:
      "Retrieve video metadata from LinkedIn Marketing API. Read-only.",
    parameters: z
      .object({
        video_urns: z.string().optional().describe("Comma-separated LinkedIn video URNs"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_GET_AD_TARGETING_FACETS",
    description:
      "Discover available ad targeting options (locations, industries, job functions). Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "LINKEDIN_GET_AUDIENCE_COUNTS",
    description:
      "Retrieve audience size counts for specified targeting criteria. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "LINKEDIN_LIST_REACTIONS",
    description:
      "List reactions (likes, celebrations, etc.) on a LinkedIn entity. Read-only.",
    parameters: z
      .object({
        entity_urn: z.string().describe("LinkedIn entity URN (share, post, or comment)"),
      })
      .passthrough(),
  },
  {
    slug: "LINKEDIN_SEARCH_AD_TARGETING_ENTITIES",
    description:
      "Search for ad targeting entities (geo, job titles, industries). Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Search query for targeting entities"),
        type: z.string().optional().describe("Entity type filter (e.g. 'LOCATION', 'INDUSTRY', 'JOB_TITLE')"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ────────────────────────────────────
  {
    slug: "LINKEDIN_CREATE_LINKED_IN_POST",
    description:
      "Create a new post on LinkedIn for the authenticated user or managed org. Requires user approval before it runs.",
    parameters: z
      .object({
        text: z.string().describe("Post content text"),
        author: z.string().describe("Author URN (person or organization)"),
        visibility: z.enum(["PUBLIC", "CONNECTIONS", "LOGGED_IN"]).optional(),
        image_urn: z.string().optional().describe("Image URN from initialize/register image upload"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create LinkedIn post",
      preview: `${String(a["text"] ?? "").slice(0, 500)}`,
      confirmText: "Create post",
    }),
  },
  {
    slug: "LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE",
    description:
      "Share a URL with commentary on LinkedIn. Requires user approval before it runs.",
    parameters: z
      .object({
        url: z.string().describe("URL to share"),
        text: z.string().describe("Optional commentary text"),
        visibility: z.enum(["PUBLIC", "CONNECTIONS", "LOGGED_IN"]).optional(),
        author: z.string().describe("Author URN"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Share URL on LinkedIn",
      preview: `${String(a["text"] ?? "").slice(0, 300)}\n\n${String(a["url"] ?? "")}`,
      confirmText: "Share URL",
    }),
  },
  {
    slug: "LINKEDIN_CREATE_COMMENT_ON_POST",
    description:
      "Add a comment or reply to a LinkedIn post. Requires user approval before it runs.",
    parameters: z
      .object({
        post_urn: z.string().describe("LinkedIn post URN to comment on"),
        text: z.string().describe("Comment text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Comment on LinkedIn post",
      preview: `${String(a["text"] ?? "").slice(0, 500)}`,
      confirmText: "Post comment",
    }),
  },
  {
    slug: "LINKEDIN_INITIALIZE_IMAGE_UPLOAD",
    description:
      "Initialize an image upload to LinkedIn (returns presigned upload URL + image URN). Requires user approval before it runs.",
    parameters: z
      .object({
        author: z.string().describe("Author URN for the image upload"),
      })
      .passthrough(),
    preview: () => ({
      title: "Initialize LinkedIn image upload",
      preview: "Prepares an image upload to LinkedIn",
      confirmText: "Initialize upload",
    }),
  },
  {
    slug: "LINKEDIN_REGISTER_IMAGE_UPLOAD",
    description:
      "Register a native LinkedIn image upload for feed shares. Returns presigned upload URL + asset URN. Requires user approval before it runs.",
    parameters: z
      .object({
        author: z.string().describe("Author URN for the image upload"),
      })
      .passthrough(),
    preview: () => ({
      title: "Register LinkedIn image upload",
      preview: "Registers an image for LinkedIn feed share",
      confirmText: "Register upload",
    }),
  },

  // ── Irreversible actions (gated + warning) ───────────────────
  {
    slug: "LINKEDIN_DELETE_LINKED_IN_POST",
    description:
      "Delete a specific LinkedIn post by share ID. This cannot be undone.",
    parameters: z
      .object({
        share_id: z.string().describe("Share ID of the LinkedIn post to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete LinkedIn post",
      preview: `Delete post ${String(a["share_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete post",
    }),
  },
  {
    slug: "LINKEDIN_DELETE_POST",
    description:
      "Delete a LinkedIn post using the Posts API. This cannot be undone.",
    parameters: z
      .object({
        post_urn: z.string().describe("Post URN to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete LinkedIn post",
      preview: `Delete post ${String(a["post_urn"] ?? "")} — this cannot be undone`,
      confirmText: "Delete post",
    }),
  },
  {
    slug: "LINKEDIN_DELETE_UGC_POST",
    description:
      "Delete a UGC post using the legacy API. This cannot be undone.",
    parameters: z
      .object({
        ugc_post_urn: z.string().describe("UGC post URN to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete UGC post (legacy)",
      preview: `Delete UGC post ${String(a["ugc_post_urn"] ?? "")} — this cannot be undone`,
      confirmText: "Delete post",
    }),
  },
]

export function makeComposioLinkedInDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "linkedin",
    name: "LinkedIn",
    category: "communication",
    icon: "linkedin",
    description: "Post updates, share articles, manage comments, and read your profile via LinkedIn (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: LINKEDIN_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_LINKEDIN_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "LinkedIn uses Composio's managed OAuth app — just connect your LinkedIn account through the dashboard",
        "Set COMPOSIO_API_KEY and COMPOSIO_LINKEDIN_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=linkedin to route LinkedIn through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_LINKEDIN_AUTH_CONFIG_ID", label: "Composio LinkedIn auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/linkedin",
    },
    tools: createComposioTools({
      provider: "linkedin",
      toolkit: LINKEDIN_TOOLKIT,
      specs: linkedinComposioSpecs,
      executor,
    }),
  }
}
