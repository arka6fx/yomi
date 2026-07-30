import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const HUBSPOT_TOOLKIT = "hubspot"

// Curated subset of HubSpot's real ~304-tool catalog: companies, contacts,
// deals, and tickets — get/list/search/create/update/archive for each.
export const hubspotComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "HUBSPOT_HUBSPOT_GET_COMPANY",
    description: "Get a HubSpot company by ID. Read-only.",
    parameters: z
      .object({
        companyId: z.string().describe("Company ID"),
        properties: z.array(z.string()).optional().describe("Properties to return"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_HUBSPOT_LIST_COMPANIES",
    description: "List HubSpot companies. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().optional().describe("Max results"),
        properties: z.array(z.string()).optional().describe("Properties to return"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_HUBSPOT_SEARCH_COMPANIES",
    description: "Search companies with flexible filters. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Free-text search"),
        filterGroups: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("Filter criteria"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_HUBSPOT_LIST_CONTACTS",
    description: "List HubSpot contacts. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().optional().describe("Max results"),
        properties: z.array(z.string()).optional().describe("Properties to return"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
    description: "Search contacts by text query or filters. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Free-text search"),
        filterGroups: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("Filter criteria"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_HUBSPOT_GET_DEAL",
    description: "Get a HubSpot deal by ID. Read-only.",
    parameters: z
      .object({
        dealId: z.string().describe("Deal ID"),
        properties: z.array(z.string()).optional().describe("Properties to return"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_HUBSPOT_LIST_DEALS",
    description: "List HubSpot deals. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().optional().describe("Max results"),
        properties: z.array(z.string()).optional().describe("Properties to return"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_HUBSPOT_SEARCH_DEALS",
    description: "Search deals with flexible filters. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Free-text search"),
        filterGroups: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("Filter criteria"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_GET_TICKET",
    description: "Get a HubSpot ticket by ID. Read-only.",
    parameters: z
      .object({
        ticketId: z.string().describe("Ticket ID"),
        properties: z.array(z.string()).optional().describe("Properties to return"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_LIST_TICKETS",
    description: "List HubSpot tickets. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().optional().describe("Max results"),
        properties: z.array(z.string()).optional().describe("Properties to return"),
      })
      .passthrough(),
  },
  {
    slug: "HUBSPOT_SEARCH_TICKETS",
    description: "Search tickets with flexible filters. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Free-text search"),
        filterGroups: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("Filter criteria"),
      })
      .passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "HUBSPOT_CREATE_COMPANY",
    description: "Create a new company. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().optional().describe("Company name"),
        domain: z.string().optional().describe("Company domain"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create company",
      preview: `Create company "${String(a["name"] ?? "")}"`,
      confirmText: "Create company",
    }),
  },
  {
    slug: "HUBSPOT_HUBSPOT_UPDATE_COMPANY",
    description: "Update an existing company's properties. Requires user approval before it runs.",
    parameters: z
      .object({
        companyId: z.string().describe("Company ID"),
        properties: z.record(z.string(), z.unknown()).describe("Properties to update"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update company",
      preview: `Update company ${String(a["companyId"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "HUBSPOT_CREATE_CONTACT",
    description: "Create a new contact. Requires user approval before it runs.",
    parameters: z
      .object({
        email: z.string().optional().describe("Contact email"),
        firstname: z.string().optional().describe("First name"),
        lastname: z.string().optional().describe("Last name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create contact",
      preview: `Create contact ${String(a["firstname"] ?? a["email"] ?? "")}`,
      confirmText: "Create contact",
    }),
  },
  {
    slug: "HUBSPOT_HUBSPOT_UPDATE_CONTACT",
    description: "Update an existing contact's properties. Requires user approval before it runs.",
    parameters: z
      .object({
        contactId: z.string().describe("Contact ID"),
        properties: z.record(z.string(), z.unknown()).describe("Properties to update"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update contact",
      preview: `Update contact ${String(a["contactId"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "HUBSPOT_CREATE_DEAL",
    description: "Create a new deal. Requires user approval before it runs.",
    parameters: z
      .object({
        dealname: z.string().optional().describe("Deal name"),
        amount: z.string().optional().describe("Deal amount"),
        dealstage: z.string().optional().describe("Pipeline stage"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create deal",
      preview: `Create deal "${String(a["dealname"] ?? "")}"`,
      confirmText: "Create deal",
    }),
  },
  {
    slug: "HUBSPOT_HUBSPOT_UPDATE_DEAL",
    description: "Update an existing deal's properties. Requires user approval before it runs.",
    parameters: z
      .object({
        dealId: z.string().describe("Deal ID"),
        properties: z.record(z.string(), z.unknown()).describe("Properties to update"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update deal",
      preview: `Update deal ${String(a["dealId"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "HUBSPOT_CREATE_TICKET",
    description: "Create a new support ticket. Requires user approval before it runs.",
    parameters: z
      .object({
        subject: z.string().optional().describe("Ticket subject"),
        content: z.string().optional().describe("Ticket description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create ticket",
      preview: `Create ticket "${String(a["subject"] ?? "")}"`,
      confirmText: "Create ticket",
    }),
  },
  {
    slug: "HUBSPOT_UPDATE_TICKET",
    description: "Update an existing ticket's properties. Requires user approval before it runs.",
    parameters: z
      .object({
        ticketId: z.string().describe("Ticket ID"),
        properties: z.record(z.string(), z.unknown()).describe("Properties to update"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update ticket",
      preview: `Update ticket ${String(a["ticketId"] ?? "")}`,
      confirmText: "Update",
    }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "HUBSPOT_ARCHIVE_COMPANY",
    description: "Archive (soft-delete) a company. This cannot be undone via this tool.",
    parameters: z.object({ companyId: z.string().describe("Company ID") }).passthrough(),
    preview: (a) => ({
      title: "Archive company",
      preview: `Archive company ${String(a["companyId"] ?? "")}`,
      confirmText: "Archive",
    }),
  },
  {
    slug: "HUBSPOT_ARCHIVE_CONTACT_BY_ID",
    description: "Archive (soft-delete) a contact. This cannot be undone via this tool.",
    parameters: z.object({ contactId: z.string().describe("Contact ID") }).passthrough(),
    preview: (a) => ({
      title: "Archive contact",
      preview: `Archive contact ${String(a["contactId"] ?? "")}`,
      confirmText: "Archive",
    }),
  },
  {
    slug: "HUBSPOT_HUBSPOT_ARCHIVE_DEALS",
    description: "Archive (soft-delete) one or more deals. This cannot be undone via this tool.",
    parameters: z
      .object({
        inputs: z.array(z.record(z.string(), z.unknown())).describe("Deal IDs to archive"),
      })
      .passthrough(),
    preview: () => ({ title: "Archive deals", preview: "Archive deal(s)", confirmText: "Archive" }),
  },
  {
    slug: "HUBSPOT_ARCHIVE_TICKET",
    description: "Archive (soft-delete) a ticket. This cannot be undone via this tool.",
    parameters: z.object({ ticketId: z.string().describe("Ticket ID") }).passthrough(),
    preview: (a) => ({
      title: "Archive ticket",
      preview: `Archive ticket ${String(a["ticketId"] ?? "")}`,
      confirmText: "Archive",
    }),
  },
]

export function makeComposioHubspotDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    icon: "hubspot",
    description: "HubSpot — manage companies, contacts, deals, and support tickets (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: HUBSPOT_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_HUBSPOT_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a HubSpot auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_HUBSPOT_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=hubspot to route HubSpot through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_HUBSPOT_AUTH_CONFIG_ID",
          label: "Composio HubSpot auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/hubspot",
    },
    tools: createComposioTools({
      provider: "hubspot",
      toolkit: HUBSPOT_TOOLKIT,
      specs: hubspotComposioSpecs,
      executor,
    }),
  }
}
