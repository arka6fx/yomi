import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const GOOGLE_SEARCH_CONSOLE_TOOLKIT = "google_search_console"

export const googleSearchConsoleComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
    description: "List all sites owned/verified by the authenticated user. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "GOOGLE_SEARCH_CONSOLE_LIST_SITEMAPS",
    description: "List sitemaps submitted for a site. Read-only.",
    parameters: z.object({ site_url: z.string().describe("Verified site URL") }).passthrough(),
  },
  {
    slug: "GOOGLE_SEARCH_CONSOLE_GET_SITEMAP",
    description: "Get details of a specific sitemap. Read-only.",
    parameters: z.object({
      site_url: z.string().describe("Verified site URL"),
      feedpath: z.string().describe("Sitemap URL/feed path"),
    }).passthrough(),
  },
  {
    slug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
    description: "Query search analytics data (clicks, impressions, CTR, position) for a site. Read-only.",
    parameters: z.object({
      site_url: z.string().describe("Verified site URL"),
      start_date: z.string().describe("Start date (YYYY-MM-DD)"),
      end_date: z.string().describe("End date (YYYY-MM-DD)"),
      dimensions: z.array(z.string()).optional().describe("Dimensions: 'query', 'page', 'country', 'device', 'date'"),
      row_limit: z.number().int().optional().describe("Max rows to return"),
    }).passthrough(),
  },
  {
    slug: "GOOGLE_SEARCH_CONSOLE_INSPECT_URL",
    description: "Inspect a URL in Search Console for indexing status and issues. Read-only.",
    parameters: z.object({
      site_url: z.string().describe("Verified site URL"),
      inspection_url: z.string().describe("URL to inspect"),
      url: z.string().describe("URL to inspect (same as inspection_url)"),
    }).passthrough(),
  },
  {
    slug: "GOOGLE_SEARCH_CONSOLE_SUBMIT_SITEMAP",
    description: "Submit a sitemap for indexing. Requires approval.",
    parameters: z.object({
      site_url: z.string().describe("Verified site URL"),
      feedpath: z.string().describe("Sitemap URL/feed path"),
    }).passthrough(),
    preview: (a) => ({
      title: "Submit sitemap",
      preview: `Submit ${String(a["feedpath"] ?? "")} for ${String(a["site_url"] ?? "")}`,
      confirmText: "Submit",
    }),
  },
]

export function makeComposioGoogleSearchConsoleDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-search-console",
    name: "Google Search Console",
    category: "data-analytics",
    icon: "google-search-console",
    description: "Google Search Console — monitor and optimize your site's search performance, index coverage, and sitemaps (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: GOOGLE_SEARCH_CONSOLE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GOOGLE_SEARCH_CONSOLE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Google Search Console auth config in Composio (uses Google OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_GOOGLE_SEARCH_CONSOLE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-search-console to route Google Search Console through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_GOOGLE_SEARCH_CONSOLE_AUTH_CONFIG_ID", label: "Composio Google Search Console auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/google_search_console",
    },
    tools: createComposioTools({
      provider: "google-search-console",
      toolkit: GOOGLE_SEARCH_CONSOLE_TOOLKIT,
      specs: googleSearchConsoleComposioSpecs,
      executor,
    }),
  }
}
