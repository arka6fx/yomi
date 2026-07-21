import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const FIRECRAWL_TOOLKIT = "firecrawl"

export const firecrawlComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "FIRECRAWL_SCRAPE",
    description: "Scrape a publicly accessible URL and return its content. Read-only.",
    parameters: z.object({
      url: z.string().describe("URL to scrape"),
      onlyMainContent: z.boolean().optional().describe("Strip nav/ads/footers"),
      formats: z.array(z.string()).optional().describe("Output formats, e.g. 'markdown', 'html'"),
    }).passthrough(),
  },
  {
    slug: "FIRECRAWL_SEARCH",
    description: "Search the web and scrape content from the top results. Read-only.",
    parameters: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().int().optional().describe("Max results"),
    }).passthrough(),
  },
  {
    slug: "FIRECRAWL_MAP_MULTIPLE_URLS_BASED_ON_OPTIONS",
    description: "Discover URLs on a website starting from a base URL. Read-only.",
    parameters: z.object({
      url: z.string().describe("Starting URL"),
      search: z.string().optional().describe("Filter discovered URLs by search term"),
      limit: z.number().int().optional().describe("Max URLs to return"),
    }).passthrough(),
  },
  {
    slug: "FIRECRAWL_GET_THE_STATUS_OF_A_CRAWL_JOB",
    description: "Get the status/progress of a crawl job. Read-only.",
    parameters: z.object({ id: z.string().describe("Crawl job ID") }).passthrough(),
  },
  {
    slug: "FIRECRAWL_CRAWL",
    description: "Crawl a website starting from a URL, following links up to a depth/page limit. Requires user approval before it runs.",
    parameters: z.object({
      url: z.string().describe("Starting URL"),
      limit: z.number().int().optional().describe("Max pages to crawl"),
      maxDepth: z.number().int().optional().describe("Max link depth"),
    }).passthrough(),
    preview: (a) => ({ title: "Start crawl", preview: `Crawl ${String(a["url"] ?? "")}`, confirmText: "Start crawl" }),
  },
  {
    slug: "FIRECRAWL_EXTRACT",
    description: "Extract structured data from web pages using a prompt or schema. Requires user approval before it runs.",
    parameters: z.object({
      urls: z.array(z.string()).describe("URLs to extract from"),
      prompt: z.string().optional().describe("Extraction instructions"),
      schema: z.record(z.string(), z.unknown()).optional().describe("JSON schema for the extracted data"),
    }).passthrough(),
    preview: (a) => ({ title: "Extract data", preview: `Extract from ${Array.isArray(a["urls"]) ? (a["urls"] as unknown[]).length : 0} URL(s)`, confirmText: "Extract" }),
  },
  {
    slug: "FIRECRAWL_CANCEL_A_CRAWL_JOB",
    description: "Cancel an active or queued crawl job. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Crawl job ID") }).passthrough(),
    preview: (a) => ({ title: "Cancel crawl", preview: `Cancel crawl job ${String(a["id"] ?? "")}`, confirmText: "Cancel" }),
  },
]

export function makeComposioFirecrawlDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "firecrawl",
    name: "Firecrawl",
    category: "data",
    icon: "firecrawl",
    description: "Firecrawl — scrape, crawl, map, and extract structured data from websites (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: FIRECRAWL_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Firecrawl auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=firecrawl to route Firecrawl through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID", label: "Composio Firecrawl auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/firecrawl",
    },
    tools: createComposioTools({
      provider: "firecrawl",
      toolkit: FIRECRAWL_TOOLKIT,
      specs: firecrawlComposioSpecs,
      executor,
    }),
  }
}
