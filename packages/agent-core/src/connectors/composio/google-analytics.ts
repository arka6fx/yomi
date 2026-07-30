import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const GOOGLE_ANALYTICS_TOOLKIT = "google_analytics"

// Composio's Google Analytics toolkit only covers account/audience admin —
// there is no run-report/realtime-metrics action.
export const googleAnalyticsComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLE_ANALYTICS_LIST_ACCOUNTS",
    description: "List all Google Analytics accounts accessible to the user. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Max results per page"),
        pageToken: z.string().optional().describe("Pagination token"),
        showDeleted: z.boolean().optional().describe("Include soft-deleted accounts"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_ANALYTICS_GET_ACCOUNT",
    description: "Get details of a specific Analytics account. Read-only.",
    parameters: z
      .object({ name: z.string().describe("Account resource name, e.g. 'accounts/123'") })
      .passthrough(),
  },
  {
    slug: "GOOGLE_ANALYTICS_LIST_AUDIENCES",
    description: "List audiences configured on a property. Read-only.",
    parameters: z
      .object({
        parent: z.string().describe("Property resource name, e.g. 'properties/123'"),
        pageSize: z.number().int().optional().describe("Max results per page"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_ANALYTICS_CREATE_EXPANDED_DATA_SET",
    description: "Create an expanded data set for a property. Requires approval.",
    parameters: z
      .object({
        parent: z.string().describe("Property resource name, e.g. 'properties/123'"),
        expandedDataSet: z
          .record(z.string(), z.unknown())
          .describe("Expanded data set configuration"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create expanded data set",
      preview: `Create data set on ${String(a["parent"] ?? "")}`,
      confirmText: "Create",
    }),
  },
]

export function makeComposioGoogleAnalyticsDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-analytics",
    name: "Google Analytics",
    category: "data-analytics",
    icon: "google-analytics",
    description: "Google Analytics 4 — list accounts and manage audiences (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: GOOGLE_ANALYTICS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GOOGLE_ANALYTICS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Google Analytics auth config in Composio (uses Google OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_GOOGLE_ANALYTICS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-analytics to route Google Analytics through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_GOOGLE_ANALYTICS_AUTH_CONFIG_ID",
          label: "Composio Google Analytics auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/google_analytics",
    },
    tools: createComposioTools({
      provider: "google-analytics",
      toolkit: GOOGLE_ANALYTICS_TOOLKIT,
      specs: googleAnalyticsComposioSpecs,
      executor,
    }),
  }
}
