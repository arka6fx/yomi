import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

// Composio's real toolkit slug is "googleads" (no underscore) — verified
// against the live auth-configs/tools catalog, not "google_ads".
export const GOOGLE_ADS_TOOLKIT = "googleads"

// Composio's Google Ads toolkit only exposes campaign lookup and customer-list
// management — there is no campaign-create/GAQL-search/reporting action.
export const googleAdsComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLEADS_GET_CAMPAIGN_BY_ID",
    description: "Get details of a campaign by ID. Read-only.",
    parameters: z.object({ id: z.string().describe("Campaign ID") }).passthrough(),
  },
  {
    slug: "GOOGLEADS_GET_CAMPAIGN_BY_NAME",
    description: "Get details of a campaign by name. Read-only.",
    parameters: z.object({ name: z.string().describe("Campaign name") }).passthrough(),
  },
  {
    slug: "GOOGLEADS_GET_CUSTOMER_LISTS",
    description: "List all customer match lists. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "GOOGLEADS_CREATE_CUSTOMER_LIST",
    description: "Create a new customer match list. Requires approval.",
    parameters: z
      .object({
        name: z.string().describe("List name"),
        description: z.string().optional().describe("List description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create customer list",
      preview: `Create list "${String(a["name"] ?? "")}"`,
      confirmText: "Create list",
    }),
  },
  {
    slug: "GOOGLEADS_GOOGLEADS_ADD_OR_REMOVE_TO_CUSTOMER_LIST",
    description: "Add or remove contacts (by email) from a customer match list. Requires approval.",
    parameters: z
      .object({
        resource_name: z.string().describe("Customer list resource name"),
        emails: z.array(z.string()).describe("Emails to add or remove"),
        operation: z.string().optional().describe("'add' or 'remove'"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update customer list",
      preview: `${String(a["operation"] ?? "add")} ${Array.isArray(a["emails"]) ? (a["emails"] as unknown[]).length : 0} email(s)`,
      confirmText: "Apply",
    }),
  },
]

export function makeComposioGoogleAdsDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-ads",
    name: "Google Ads",
    category: "data-analytics",
    icon: "google-ads",
    description: "Google Ads — look up campaigns and manage customer match lists (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: GOOGLE_ADS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GOOGLE_ADS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Google Ads auth config in Composio (uses Google OAuth + developer token)",
        "Set COMPOSIO_API_KEY and COMPOSIO_GOOGLE_ADS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-ads to route Google Ads through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_GOOGLE_ADS_AUTH_CONFIG_ID",
          label: "Composio Google Ads auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googleads",
    },
    tools: createComposioTools({
      provider: "google-ads",
      toolkit: GOOGLE_ADS_TOOLKIT,
      specs: googleAdsComposioSpecs,
      executor,
    }),
  }
}
