import { z } from "zod"
import { tool, type ToolSet } from "ai"
import type { ConnectorDef, ConnectorContext } from "../connector-def.js"
import { connectorError, gateWrite } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const INSTAGRAM_TOOLKIT = "instagram"

export const instagramComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "INSTAGRAM_GET_USER_INFO",
    description: "Get Instagram profile details and statistics. Read-only.",
    parameters: z
      .object({ ig_user_id: z.string().optional().describe("Instagram business account ID") })
      .passthrough(),
  },
  {
    slug: "INSTAGRAM_GET_USER_MEDIA",
    description: "Get the user's media (posts, photos, videos). Read-only.",
    parameters: z
      .object({
        ig_user_id: z.string().optional().describe("Instagram business account ID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "INSTAGRAM_GET_USER_INSIGHTS",
    description: "Get account-level insights (profile views, reach, impressions). Read-only.",
    parameters: z
      .object({
        ig_user_id: z.string().optional().describe("Instagram business account ID"),
        metric: z.array(z.string()).describe("Metrics to fetch"),
        period: z.string().optional().describe("Aggregation period"),
      })
      .passthrough(),
  },
  {
    slug: "INSTAGRAM_GET_POST_COMMENTS",
    description: "Get comments on a post. Read-only.",
    parameters: z
      .object({
        ig_post_id: z.string().describe("Post ID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "INSTAGRAM_GET_POST_INSIGHTS",
    description: "Get insights/analytics for a post (impressions, reach, engagement). Read-only.",
    parameters: z
      .object({
        ig_post_id: z.string().describe("Post ID"),
        metric: z.array(z.string()).optional().describe("Metrics to fetch"),
      })
      .passthrough(),
  },
  {
    slug: "INSTAGRAM_GET_POST_STATUS",
    description: "Check the processing status of a draft post container. Read-only.",
    parameters: z
      .object({ creation_id: z.string().describe("Media container creation ID") })
      .passthrough(),
  },
  {
    slug: "INSTAGRAM_GET_CONVERSATION",
    description: "Get details of a specific DM conversation. Read-only.",
    parameters: z.object({ conversation_id: z.string().describe("Conversation ID") }).passthrough(),
  },
  {
    slug: "INSTAGRAM_LIST_ALL_CONVERSATIONS",
    description: "List all DM conversations. Read-only.",
    parameters: z
      .object({
        ig_user_id: z.string().optional().describe("Instagram business account ID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "INSTAGRAM_LIST_ALL_MESSAGES",
    description: "List messages in a DM conversation. Read-only.",
    parameters: z
      .object({
        conversation_id: z.string().describe("Conversation ID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  // ig_user_id is auto-filled from INSTAGRAM_GET_USER_INFO right before each
  // call runs (see `resolvedParams` below) — the model has no way to know the
  // real Instagram Business Account ID, and a guessed value fails with a
  // confusing Graph API error instead of a clean one. Kept optional/described
  // in the schema only so a model that fills it in anyway doesn't hard-fail
  // validation; the resolved value always wins.
  {
    slug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    description:
      "Create a draft media container for a carousel item. For a single photo/video/reel post, use INSTAGRAM_PUBLISH_MEDIA instead — it handles the whole create/wait/publish sequence in one approval. Requires user approval before it runs.",
    parameters: z
      .object({
        ig_user_id: z
          .string()
          .optional()
          .describe("Instagram business account ID (auto-filled, leave blank)"),
        image_url: z.string().optional().describe("Image URL"),
        video_url: z.string().optional().describe("Video URL"),
        caption: z.string().optional().describe("Caption"),
      })
      .passthrough(),
    resolvedParams: { ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } },
    preview: (a) => ({
      title: "Create media container",
      preview: String(a["caption"] ?? "New media").slice(0, 100),
      confirmText: "Create",
    }),
  },
  {
    slug: "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
    description:
      "Create a draft carousel post with multiple images/videos. Requires user approval before it runs.",
    parameters: z
      .object({
        ig_user_id: z
          .string()
          .optional()
          .describe("Instagram business account ID (auto-filled, leave blank)"),
        children: z.array(z.string()).describe("Media container IDs"),
        caption: z.string().optional().describe("Caption"),
      })
      .passthrough(),
    resolvedParams: { ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } },
    preview: (a) => ({
      title: "Create carousel",
      preview: String(a["caption"] ?? "New carousel").slice(0, 100),
      confirmText: "Create",
    }),
  },
  {
    slug: "INSTAGRAM_CREATE_POST",
    description:
      "Publish a draft carousel container to Instagram (final publishing step). For a single photo/video/reel post, use INSTAGRAM_PUBLISH_MEDIA instead. Requires user approval before it runs.",
    parameters: z
      .object({
        ig_user_id: z
          .string()
          .optional()
          .describe("Instagram business account ID (auto-filled, leave blank)"),
        creation_id: z.string().describe("Media container ID to publish"),
      })
      .passthrough(),
    resolvedParams: { ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } },
    preview: (a) => ({
      title: "Publish post",
      preview: `Publish container ${String(a["creation_id"] ?? "")}`,
      confirmText: "Publish",
    }),
  },
  {
    slug: "INSTAGRAM_REPLY_TO_COMMENT",
    description: "Reply to a comment on a post. Requires user approval before it runs.",
    parameters: z
      .object({
        ig_comment_id: z.string().describe("Comment ID"),
        message: z.string().describe("Reply text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Reply to comment",
      preview: String(a["message"] ?? "").slice(0, 100),
      confirmText: "Reply",
    }),
  },
  {
    slug: "INSTAGRAM_SEND_TEXT_MESSAGE",
    description: "Send a text DM to a user. Requires user approval before it runs.",
    parameters: z
      .object({
        recipient_id: z.string().describe("Recipient user ID"),
        text: z.string().describe("Message text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Send DM",
      preview: String(a["text"] ?? "").slice(0, 100),
      confirmText: "Send",
    }),
  },
  {
    slug: "INSTAGRAM_SEND_IMAGE",
    description: "Send an image via DM to a user. Requires user approval before it runs.",
    parameters: z
      .object({
        recipient_id: z.string().describe("Recipient user ID"),
        image_url: z.string().describe("Image URL"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Send image DM",
      preview: `Send image to ${String(a["recipient_id"] ?? "")}`,
      confirmText: "Send",
    }),
  },
  {
    slug: "INSTAGRAM_MARK_SEEN",
    description: "Mark DM messages as read for a user. Requires user approval before it runs.",
    parameters: z.object({ recipient_id: z.string().describe("Recipient user ID") }).passthrough(),
    preview: (a) => ({
      title: "Mark as seen",
      preview: `Mark messages seen for ${String(a["recipient_id"] ?? "")}`,
      confirmText: "Mark seen",
    }),
  },
]

function isExecutorError(result: unknown): result is { error: string } {
  return (
    typeof result === "object" &&
    result !== null &&
    typeof (result as { error?: unknown }).error === "string"
  )
}

// Instagram's publish flow is really one user-facing decision ("post it or
// don't") split across three Graph API calls: create a draft container, wait
// for Meta to finish fetching/validating the media, then publish it. Exposing
// those as three separately-tool-called steps let a model chain them
// unreliably — a container could finish processing successfully while a
// *later, unrelated* agent turn confidently told the user the media fetch had
// failed (it hadn't; the turn just never checked, or read a transient
// IN_PROGRESS status as permanent). This runs all three deterministically,
// in one place, behind one approval.
export async function publishInstagramMedia(
  executor: ComposioExecutor,
  userId: string,
  args: { image_url?: string; video_url?: string; caption?: string },
  opts?: { pollIntervalMs?: number; timeoutMs?: number },
): Promise<unknown> {
  const pollIntervalMs = opts?.pollIntervalMs ?? 3000
  const timeoutMs = opts?.timeoutMs ?? 45_000

  const info = await executor.execute({ userId, slug: "INSTAGRAM_GET_USER_INFO", arguments: {} })
  const igUserId = (info as { id?: unknown } | null)?.id
  if (typeof igUserId !== "string" || !igUserId) {
    return { error: "Could not resolve the connected Instagram account." }
  }

  const created = await executor.execute({
    userId,
    slug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    arguments: {
      ig_user_id: igUserId,
      image_url: args.image_url,
      video_url: args.video_url,
      caption: args.caption,
    },
  })
  if (isExecutorError(created)) return created
  const creationId = (created as { id?: unknown } | null)?.id
  if (typeof creationId !== "string" || !creationId) {
    return { error: "Instagram did not return a container id." }
  }

  const deadline = Date.now() + timeoutMs
  let statusCode = "IN_PROGRESS"
  // IN_PROGRESS is Meta still fetching/validating the media — normal, not a
  // failure. Poll until it lands on a terminal state instead of giving up on
  // the first non-FINISHED read.
  for (;;) {
    const status = await executor.execute({
      userId,
      slug: "INSTAGRAM_GET_POST_STATUS",
      arguments: { creation_id: creationId },
    })
    if (isExecutorError(status)) return status
    statusCode = String((status as { status_code?: unknown } | null)?.status_code ?? statusCode)
    if (statusCode !== "IN_PROGRESS") break
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  if (statusCode !== "FINISHED") {
    return { error: `Instagram couldn't process the media (status: ${statusCode}).` }
  }

  return executor.execute({
    userId,
    slug: "INSTAGRAM_CREATE_POST",
    arguments: { ig_user_id: igUserId, creation_id: creationId },
  })
}

export function makeComposioInstagramDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "instagram",
    name: "Instagram",
    category: "communication",
    icon: "instagram",
    description:
      "Instagram — post photos/videos/carousels, reply to comments, and manage DMs (via Composio).",
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
        {
          env: "COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID",
          label: "Composio Instagram auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/instagram",
    },
    tools: (ctx: ConnectorContext): ToolSet => {
      const baseTools = createComposioTools({
        provider: "instagram",
        toolkit: INSTAGRAM_TOOLKIT,
        specs: instagramComposioSpecs,
        executor,
      })(ctx)

      return {
        ...baseTools,
        INSTAGRAM_PUBLISH_MEDIA: tool({
          description:
            "Post a single photo, video, or reel to Instagram in one step: creates the draft, " +
            "waits for Meta to finish processing it, and publishes automatically. Use this instead " +
            "of INSTAGRAM_CREATE_MEDIA_CONTAINER + INSTAGRAM_CREATE_POST for a single item — those " +
            "are for building a carousel's individual items only. Requires user approval before it runs.",
          parameters: z
            .object({
              image_url: z.string().optional().describe("Image URL"),
              video_url: z.string().optional().describe("Video URL"),
              caption: z.string().optional().describe("Caption"),
            })
            .passthrough(),
          execute: async (args: Record<string, unknown>) => {
            try {
              return await gateWrite(
                ctx,
                {
                  connector: "instagram",
                  action: "INSTAGRAM_PUBLISH_MEDIA",
                  risk: "irreversible",
                  title: "Post to Instagram",
                  preview: String(args["caption"] ?? "New post").slice(0, 100),
                  confirmText: "Post",
                },
                args,
                () =>
                  publishInstagramMedia(executor, ctx.userId, {
                    image_url: args["image_url"] as string | undefined,
                    video_url: args["video_url"] as string | undefined,
                    caption: args["caption"] as string | undefined,
                  }),
              )
            } catch (err) {
              return connectorError(err)
            }
          },
        }),
      }
    },
  }
}
