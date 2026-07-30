import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const LINKEDIN_TOOLKIT = "linkedin"

// Real LinkedIn catalog is minimal: profile/org lookup and post create/delete —
// no comment management, no article sharing, no analytics.
export const linkedinComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "LINKEDIN_GET_MY_INFO",
    description:
      "Get the authenticated user's LinkedIn profile, including the author ID needed to post. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "LINKEDIN_GET_COMPANY_INFO",
    description: "List organizations the authenticated user manages. Read-only.",
    parameters: z.object({ role: z.string().optional().describe("Filter by role") }).passthrough(),
  },
  {
    slug: "LINKEDIN_CREATE_LINKED_IN_POST",
    description:
      "Create a new post on LinkedIn for the user or an organization they manage. Requires user approval before it runs.",
    parameters: z
      .object({
        author: z.string().describe("Author URN (person or organization)"),
        commentary: z.string().describe("Post text"),
        visibility: z.string().optional().describe("'PUBLIC' or 'CONNECTIONS'"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create post",
      preview: String(a["commentary"] ?? "").slice(0, 150),
      confirmText: "Post",
    }),
  },
  {
    slug: "LINKEDIN_DELETE_LINKED_IN_POST",
    description: "Delete a LinkedIn post. This cannot be undone.",
    parameters: z.object({ share_id: z.string().describe("Post share ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete post",
      preview: `Delete post ${String(a["share_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
]

export function makeComposioLinkedInDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "linkedin",
    name: "LinkedIn",
    category: "communication",
    icon: "linkedin",
    description: "Post updates to LinkedIn and read your profile/organization info (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: LINKEDIN_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_LINKEDIN_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a LinkedIn auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_LINKEDIN_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=linkedin to route LinkedIn through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_LINKEDIN_AUTH_CONFIG_ID",
          label: "Composio LinkedIn auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/linkedin",
    },
    tools: createComposioTools({
      provider: "linkedin",
      toolkit: LINKEDIN_TOOLKIT,
      specs: linkedinComposioSpecs,
      executor,
    }),
  }
}
