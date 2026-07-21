import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const EXA_TOOLKIT = "exa"

// Real Exa catalog covers web search/answer/similar-page-finding plus
// "Websets" (Exa's saved-search/monitoring product) — no research-report tools.
export const exaComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "EXA_SEARCH",
    description: "Search the web with Exa's neural/keyword search engine, with filtering options. Read-only.",
    parameters: z.object({
      query: z.string().describe("Search query"),
      numResults: z.number().int().optional().describe("Max results"),
      includeDomains: z.array(z.string()).optional().describe("Restrict to these domains"),
      excludeDomains: z.array(z.string()).optional().describe("Exclude these domains"),
    }).passthrough(),
  },
  {
    slug: "EXA_ANSWER",
    description: "Get a direct, citation-backed answer to a natural-language question. Read-only.",
    parameters: z.object({ query: z.string().describe("Question or topic") }).passthrough(),
  },
  {
    slug: "EXA_FIND_SIMILAR",
    description: "Find web pages semantically similar to a given URL. Read-only.",
    parameters: z.object({ url: z.string().describe("Reference URL"), num_results: z.number().int().optional().describe("Max results") }).passthrough(),
  },
  {
    slug: "EXA_GET_CONTENTS_ACTION",
    description: "Get text/highlights for a list of Exa document IDs or URLs. Read-only.",
    parameters: z.object({ ids: z.array(z.string()).describe("Exa document IDs or URLs"), text: z.boolean().optional().describe("Include full text") }).passthrough(),
  },
  {
    slug: "EXA_LIST_IMPORTS",
    description: "List imports for a webset. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "EXA_LIST_WEBHOOKS",
    description: "List webhooks configured for websets. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "EXA_LIST_EVENTS",
    description: "List Websets events (paginated). Read-only.",
    parameters: z.object({ types: z.array(z.string()).optional().describe("Filter by event type") }).passthrough(),
  },
  {
    slug: "EXA_GET_EVENT",
    description: "Get details of a specific Websets event. Read-only.",
    parameters: z.object({ id: z.string().describe("Event ID") }).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "EXA_CREATE_WEBSET",
    description: "Create a webset (saved search with import/enrichment config). Requires user approval before it runs.",
    parameters: z.object({ search: z.record(z.string(), z.unknown()).describe("Search configuration for the webset") }).passthrough(),
    preview: () => ({ title: "Create webset", preview: "Create a new Exa webset", confirmText: "Create webset" }),
  },
  {
    slug: "EXA_CREATE_MONITOR",
    description: "Schedule automated updates for a webset. Requires user approval before it runs.",
    parameters: z.object({ websetId: z.string().describe("Webset ID"), cadence: z.record(z.string(), z.unknown()).describe("Update schedule"), behavior: z.record(z.string(), z.unknown()).describe("Monitor behavior config") }).passthrough(),
    preview: (a) => ({ title: "Create monitor", preview: `Create monitor for webset ${String(a["websetId"] ?? "")}`, confirmText: "Create monitor" }),
  },
  {
    slug: "EXA_CREATE_IMPORT",
    description: "Create an import to upload data into a webset. Requires user approval before it runs.",
    parameters: z.object({ entity: z.record(z.string(), z.unknown()).describe("Entity type config"), format: z.string().describe("Import format") }).passthrough(),
    preview: () => ({ title: "Create import", preview: "Create a new webset import", confirmText: "Create import" }),
  },
  {
    slug: "EXA_UPDATE_IMPORT",
    description: "Update an import's title or metadata. Requires user approval before it runs.",
    parameters: z.object({ id: z.string().describe("Import ID"), title: z.string().optional().describe("New title") }).passthrough(),
    preview: (a) => ({ title: "Update import", preview: `Update import ${String(a["id"] ?? "")}`, confirmText: "Update" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "EXA_DELETE_WEBSET",
    description: "Permanently delete a webset. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Webset ID") }).passthrough(),
    preview: (a) => ({ title: "Delete webset", preview: `Delete webset ${String(a["id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "EXA_DELETE_IMPORT",
    description: "Permanently delete an import. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Import ID") }).passthrough(),
    preview: (a) => ({ title: "Delete import", preview: `Delete import ${String(a["id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioExaDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "exa",
    name: "Exa",
    category: "data",
    icon: "exa",
    description: "Exa — neural web search, direct Q&A, similar-page discovery, and Websets (saved searches/monitors) (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: EXA_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_EXA_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://dashboard.exa.ai/api-keys",
      steps: [
        "Create an Exa auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_EXA_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=exa to route Exa through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_EXA_AUTH_CONFIG_ID", label: "Composio Exa auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/exa",
    },
    tools: createComposioTools({
      provider: "exa",
      toolkit: EXA_TOOLKIT,
      specs: exaComposioSpecs,
      executor,
    }),
  }
}
