import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const SERPAPI_TOOLKIT = "serpapi"

// SerpApi's real catalog is entirely read-only search endpoints across
// engines — no flights/hotels-specific structured tools beyond what's listed.
export const serpapiComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "SERPAPI_SEARCH",
    description: "Real-time Google search. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_NEWS_SEARCH",
    description: "Search Google News. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_IMAGE_SEARCH",
    description: "Search Google Images. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_SHOPPING_SEARCH",
    description: "Search Google Shopping for products. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_SCHOLAR_SEARCH",
    description: "Search Google Scholar for academic papers/citations. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_TRENDS_SEARCH",
    description: "Get Google Trends data for a term. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Search term(s)"),
        data_type: z.string().optional().describe("Trends data type"),
      })
      .passthrough(),
  },
  {
    slug: "SERPAPI_EVENT_SEARCH",
    description: "Search for events (concerts, festivals, conferences). Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_FINANCE_SEARCH",
    description: "Get structured financial/stock/market data. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_HOTEL_SEARCH",
    description: "Search Google Hotels. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        check_in_date: z.string().describe("Check-in date"),
        check_out_date: z.string().describe("Check-out date"),
      })
      .passthrough(),
  },
  {
    slug: "SERPAPI_GOOGLE_MAPS_SEARCH",
    description: "Search Google Maps. Read-only.",
    parameters: z.object({ q: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_GOOGLE_JOBS_SEARCH",
    description: "Search Google Jobs. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        location: z.string().optional().describe("Location filter"),
      })
      .passthrough(),
  },
  {
    slug: "SERPAPI_BING_SEARCH",
    description: "Search via Bing. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        location: z.string().optional().describe("Location filter"),
      })
      .passthrough(),
  },
  {
    slug: "SERPAPI_DUCK_DUCK_GO_SEARCH",
    description: "Search via DuckDuckGo. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_BAIDU_SEARCH",
    description: "Search via Baidu. Read-only.",
    parameters: z.object({ q: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_EBAY_SEARCH",
    description: "Search eBay listings. Read-only.",
    parameters: z.object({ nkw: z.string().describe("Search keywords") }).passthrough(),
  },
  {
    slug: "SERPAPI_WALMART_SEARCH",
    description: "Search Walmart listings. Read-only.",
    parameters: z.object({ q: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "SERPAPI_PLAY_SEARCH",
    description: "Search the Google Play Store. Read-only.",
    parameters: z.object({ q: z.string().optional().describe("Search query") }).passthrough(),
  },
]

export function makeComposioSerpapiDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "serpapi",
    name: "SerpApi",
    category: "data",
    icon: "serpapi",
    description:
      "SerpApi — real-time search results across Google, Bing, News, Shopping, Maps, Jobs, and more (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: SERPAPI_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SERPAPI_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://serpapi.com/manage-api-key",
      steps: [
        "Create a SerpApi auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_SERPAPI_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=serpapi to route SerpApi through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_SERPAPI_AUTH_CONFIG_ID",
          label: "Composio SerpApi auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/serpapi",
    },
    tools: createComposioTools({
      provider: "serpapi",
      toolkit: SERPAPI_TOOLKIT,
      specs: serpapiComposioSpecs,
      executor,
    }),
  }
}
