import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const FIRECRAWL_TOOLKIT = "firecrawl"

export const firecrawlComposioSpecs: ComposioToolSpec[] = [
  // ── Read / Search actions ─────────────────────────────────────
  {
    slug: "FIRECRAWL_SEARCH",
    description:
      "Search the web and scrape content from top results. Returns markdown content from each result. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 5)"),
        lang: z.string().optional().describe("Language code (e.g. 'en')"),
        country: z.string().optional().describe("Country code (e.g. 'us')"),
        formats: z
          .array(z.string())
          .optional()
          .describe("Output formats: 'markdown', 'html', 'rawHtml', 'links'"),
        timeout: z.number().int().min(1000).max(300000).optional().describe("Timeout in ms"),
      })
      .passthrough(),
  },
  {
    slug: "FIRECRAWL_SCRAPE",
    description:
      "Scrape a publicly accessible URL and return content as markdown, HTML, or structured JSON. Read-only.",
    parameters: z
      .object({
        url: z.string().describe("The URL to scrape (must start with http:// or https://)"),
        formats: z
          .array(z.string())
          .optional()
          .describe("Output formats: 'markdown', 'html', 'rawHtml', 'links', 'screenshot'"),
        onlyMainContent: z.coerce.boolean().optional().describe("Extract only main content, exclude nav/footer/ads"),
        timeout: z.number().int().optional().describe("Timeout in ms (default 30000)"),
        waitFor: z.number().int().optional().describe("Wait ms for dynamic content before scraping"),
        includeTags: z.array(z.string()).optional().describe("HTML tags to include"),
        excludeTags: z.array(z.string()).optional().describe("HTML tags to exclude"),
      })
      .passthrough(),
  },
  {
    slug: "FIRECRAWL_MAP_MULTIPLE_URLS_BASED_ON_OPTIONS",
    description:
      "Discover all URLs from a starting base URL. Read-only.",
    parameters: z
      .object({
        url: z.string().describe("The starting URL to map"),
        limit: z.number().int().min(1).max(100000).optional().describe("Max links to return"),
        search: z.string().optional().describe("Optional search query to guide URL discovery"),
        includeSubdomains: z.coerce.boolean().optional().describe("Include subdomains"),
        ignoreSitemap: z.coerce.boolean().optional().describe("Bypass sitemap"),
      })
      .passthrough(),
  },
  {
    slug: "FIRECRAWL_DEEP_RESEARCH",
    description:
      "AI-powered deep research that autonomously explores the web and synthesizes findings from multiple sources. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("The research question or topic"),
        maxUrls: z.number().int().min(1).max(1000).optional().describe("Max URLs to analyze (default 20)"),
        maxDepth: z.number().int().min(1).max(10).optional().describe("Research depth iterations"),
        timeLimit: z.number().int().min(30).max(300).optional().describe("Time limit in seconds"),
      })
      .passthrough(),
  },
  {
    slug: "FIRECRAWL_EXTRACT",
    description:
      "Extract structured data from web pages using a natural language prompt or JSON schema. Read-only.",
    parameters: z
      .object({
        urls: z
          .array(z.string())
          .describe("URLs to extract data from (max 10, supports wildcards like https://example.com/blog/*)"),
        prompt: z.string().optional().describe("Natural language description of data to extract"),
        schema: z.any().optional().describe("JSON schema defining the data structure"),
        enableWebSearch: z.coerce.boolean().optional().describe("Allow crawling outside initial domains"),
      })
      .passthrough(),
  },
  {
    slug: "FIRECRAWL_GET_DEEP_RESEARCH_STATUS",
    description:
      "Retrieve the status and results of a deep research job by its ID. Read-only.",
    parameters: z
      .object({
        id: z.string().describe("UUID of the deep research job"),
      })
      .passthrough(),
  },
  {
    slug: "FIRECRAWL_EXTRACT_GET",
    description:
      "Retrieve the status and results of a previously submitted extract job. Read-only.",
    parameters: z
      .object({
        id: z.string().describe("UUID of the extract job"),
      })
      .passthrough(),
  },
  {
    slug: "FIRECRAWL_GET_THE_STATUS_OF_A_CRAWL_JOB",
    description:
      "Retrieve the current status of a web crawl job. Read-only.",
    parameters: z
      .object({
        id: z.string().describe("UUID of the crawl job"),
      })
      .passthrough(),
  },

  // ── Write / Execute actions (gated) ───────────────────────────
  {
    slug: "FIRECRAWL_CRAWL",
    description:
      "Start a web crawl from a given URL. Applies filtering and content extraction rules. Requires user approval before it runs.",
    parameters: z
      .object({
        url: z.string().describe("The base URL to start crawling from"),
        limit: z.number().int().min(1).optional().describe("Maximum number of pages to crawl (default 10)"),
        maxDepth: z.number().int().min(0).optional().describe("Maximum depth of subpages to crawl"),
        includePaths: z.array(z.string()).optional().describe("Regex patterns for URL paths to include"),
        excludePaths: z.array(z.string()).optional().describe("Regex patterns for URL paths to exclude"),
        ignoreSitemap: z.coerce.boolean().optional().describe("Ignore sitemap.xml"),
        scrapeOptions_formats: z
          .array(z.string())
          .optional()
          .describe("Output formats per page (e.g. ['markdown', 'html'])"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Crawl ${String(a["url"] ?? "")}`,
      preview: `Start crawl at ${String(a["url"] ?? "")}${a["limit"] ? ` (max ${String(a["limit"])} pages)` : ""}`,
      confirmText: "Start crawl",
    }),
  },
  {
    slug: "FIRECRAWL_CRAWL_CANCEL",
    description:
      "Cancel an active or queued web crawl job. Requires user approval before it runs.",
    parameters: z
      .object({
        id: z.string().describe("UUID of the crawl job to cancel"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Cancel crawl job",
      preview: `Cancel crawl job ${String(a["id"] ?? "")}`,
      confirmText: "Cancel crawl",
    }),
  },
]

export function makeComposioFirecrawlDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "firecrawl",
    name: "Firecrawl",
    category: "data",
    icon: "firecrawl",
    description: "Scrape, search, crawl, and extract structured data from the web (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: FIRECRAWL_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Firecrawl auth config in Composio with your Firecrawl API key",
        "Set COMPOSIO_API_KEY and COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=firecrawl to route Firecrawl through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID", label: "Composio Firecrawl auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/firecrawl",
    },
    tools: createComposioTools({
      provider: "firecrawl",
      toolkit: FIRECRAWL_TOOLKIT,
      specs: firecrawlComposioSpecs,
      executor,
    }),
  }
}
