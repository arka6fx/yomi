import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const GUMROAD_TOOLKIT = "gumroad"

// Real Gumroad catalog is minimal: sales/user lookup and webhook subscription
// management — no product listing or license verification.
export const gumroadComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GUMROAD_GET_USER",
    description: "Get the authenticated user's Gumroad profile. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "GUMROAD_GET_SALES",
    description: "List successful sales for the authenticated user. Read-only.",
    parameters: z.object({
      page: z.number().int().optional().describe("Page number"),
      product_id: z.string().optional().describe("Filter by product ID"),
      email: z.string().optional().describe("Filter by buyer email"),
    }).passthrough(),
  },
  {
    slug: "GUMROAD_GET_RESOURCE_SUBSCRIPTIONS",
    description: "List active webhook subscriptions for a resource. Read-only.",
    parameters: z.object({ resource_name: z.string().describe("Resource name") }).passthrough(),
  },
  {
    slug: "GUMROAD_SUBSCRIBE_TO_RESOURCE",
    description: "Subscribe to a resource to receive real-time event webhooks. Requires user approval before it runs.",
    parameters: z.object({ resource_name: z.string().describe("Resource name"), post_url: z.string().describe("Webhook callback URL") }).passthrough(),
    preview: (a) => ({ title: "Subscribe to resource", preview: `Subscribe ${String(a["resource_name"] ?? "")} → ${String(a["post_url"] ?? "")}`, confirmText: "Subscribe" }),
  },
  {
    slug: "GUMROAD_UNSUBSCRIBE_FROM_RESOURCE",
    description: "Remove a webhook subscription. This cannot be undone.",
    parameters: z.object({ resource_subscription_id: z.string().describe("Subscription ID") }).passthrough(),
    preview: (a) => ({ title: "Unsubscribe", preview: `Remove subscription ${String(a["resource_subscription_id"] ?? "")}`, confirmText: "Unsubscribe" }),
  },
]

export function makeComposioGumroadDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "gumroad",
    name: "Gumroad",
    category: "finance",
    icon: "gumroad",
    description: "Gumroad — view sales data and manage webhook subscriptions (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: GUMROAD_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GUMROAD_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Gumroad auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_GUMROAD_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=gumroad to route Gumroad through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_GUMROAD_AUTH_CONFIG_ID", label: "Composio Gumroad auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/gumroad",
    },
    tools: createComposioTools({
      provider: "gumroad",
      toolkit: GUMROAD_TOOLKIT,
      specs: gumroadComposioSpecs,
      executor,
    }),
  }
}
