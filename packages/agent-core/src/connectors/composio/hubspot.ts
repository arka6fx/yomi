import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const HUBSPOT_TOOLKIT = "hubspot"

export const hubspotComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "HUBSPOT_LIST_CONTACTS",
    description:
      "List contacts in HubSpot CRM with pagination. Optionally filter by property values. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().min(1).max(200).optional().describe("Max contacts to return"),
        after: z.string().optional().describe("Pagination cursor from previous response"),
        properties: z.string().optional().describe("Comma-separated properties to include"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_LIST_DEALS",
    description:
      "List deals in HubSpot CRM with pagination. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().min(1).max(200).optional().describe("Max deals to return"),
        after: z.string().optional().describe("Pagination cursor from previous response"),
        properties: z.string().optional().describe("Comma-separated properties to include"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_BATCH_READ_COMPANIES_BY_PROPERTIES",
    description:
      "Batch-retrieve up to 100 HubSpot company records by their IDs. Read-only.",
    parameters: z
      .object({
        inputs: z
          .array(z.object({ id: z.string() }))
          .describe("Array of company IDs to fetch"),
        properties: z
          .array(z.string())
          .optional()
          .describe("Properties to return for each company"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_SEARCH_DEALS",
    description:
      "Search deals using flexible criteria and filters. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Search query string"),
        filterGroups: z
          .array(z.any())
          .optional()
          .describe("Filter groups for structured queries"),
        sorts: z.array(z.any()).optional().describe("Sort criteria"),
        limit: z.number().int().min(1).max(200).optional(),
        after: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_SEARCH_TICKETS",
    description:
      "Search tickets using flexible criteria and filters. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Search query string"),
        filterGroups: z.array(z.any()).optional(),
        sorts: z.array(z.any()).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        after: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_SEARCH_PRODUCTS",
    description:
      "Search products using flexible criteria and filters. Read-only.",
    parameters: z
      .object({
        query: z.string().optional(),
        filterGroups: z.array(z.any()).optional(),
        sorts: z.array(z.any()).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        after: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_SEARCH_CAMPAIGNS",
    description:
      "Search HubSpot marketing campaigns. Read-only.",
    parameters: z
      .object({
        query: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_LIST_PRODUCTS",
    description:
      "Retrieve a paginated list of HubSpot products. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        after: z.string().optional(),
        properties: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_LIST_FEEDBACK_SUBMISSIONS",
    description:
      "Retrieve a paginated list of feedback submissions. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        after: z.string().optional(),
        properties: z.string().optional(),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "HUBSPOT_CREATE_CONTACT",
    description:
      "Create a new contact in HubSpot CRM. Requires user approval before it runs.",
    parameters: z
      .object({
        properties: z.record(z.string()).describe("Contact properties (e.g. email, firstname, lastname, phone)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create HubSpot contact",
      preview: `Create contact: ${String((a["properties"] as Record<string, string>)?.["email"] ?? "")}`,
      confirmText: "Create contact",
    }),
  },
  {
    slug: "HUBSPOT_CREATE_CONTACTS",
    description:
      "Create multiple new HubSpot contacts in a batch. Requires user approval before it runs.",
    parameters: z
      .object({
        inputs: z
          .array(z.object({ properties: z.record(z.string()) }))
          .describe("Array of contacts to create"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create HubSpot contacts",
      preview: `Create ${String((a["inputs"] as Array<unknown>)?.length ?? "?")} contacts`,
      confirmText: "Create contacts",
    }),
  },
  {
    slug: "HUBSPOT_CREATE_DEAL",
    description:
      "Create a new deal in HubSpot CRM. Requires user approval before it runs.",
    parameters: z
      .object({
        properties: z.record(z.string()).describe("Deal properties (e.g. dealname, amount, dealstage, pipeline)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create HubSpot deal",
      preview: `Create deal: ${String((a["properties"] as Record<string, string>)?.["dealname"] ?? "")}`,
      confirmText: "Create deal",
    }),
  },
  {
    slug: "HUBSPOT_CREATE_TASK",
    description:
      "Create a new CRM task record. Requires user approval before it runs.",
    parameters: z
      .object({
        properties: z.record(z.string()).describe("Task properties (e.g. hs_timestamp, hs_task_body, hs_task_subject)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create HubSpot task",
      preview: `Create task: ${String((a["properties"] as Record<string, string>)?.["hs_task_subject"] ?? "")}`,
      confirmText: "Create task",
    }),
  },
  {
    slug: "HUBSPOT_CREATE_COMPANY",
    description:
      "Create a new company in HubSpot CRM. Requires user approval before it runs.",
    parameters: z
      .object({
        properties: z.record(z.string()).describe("Company properties (e.g. name, domain, industry)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create HubSpot company",
      preview: `Create company: ${String((a["properties"] as Record<string, string>)?.["name"] ?? "")}`,
      confirmText: "Create company",
    }),
  },
  {
    slug: "HUBSPOT_UPDATE_PRODUCT",
    description:
      "Update properties for an existing HubSpot product. Requires user approval before it runs.",
    parameters: z
      .object({
        productId: z.string().describe("Product ID to update"),
        properties: z.record(z.string()).describe("Product properties to update"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update HubSpot product",
      preview: `Update product ${String(a["productId"] ?? "")}`,
      confirmText: "Update product",
    }),
  },
]

export function makeComposioHubspotDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    icon: "hubspot",
    description: "Manage contacts, deals, companies, tickets, and products in HubSpot CRM (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: HUBSPOT_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_HUBSPOT_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a HubSpot auth config in Composio (or use the managed one)",
        "Set COMPOSIO_API_KEY and COMPOSIO_HUBSPOT_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=hubspot to route HubSpot through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_HUBSPOT_AUTH_CONFIG_ID", label: "Composio HubSpot auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/hubspot",
    },
    tools: createComposioTools({
      provider: "hubspot",
      toolkit: HUBSPOT_TOOLKIT,
      specs: hubspotComposioSpecs,
      executor,
    }),
  }
}
