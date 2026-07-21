import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

// Composio's real toolkit slug is "zoho_invoice" (underscore) — verified
// against the live tools catalog, not "zoho-invoice".
export const ZOHO_INVOICE_TOOLKIT = "zoho_invoice"

// Real Zoho Invoice catalog is read-only reporting (list contacts/items/
// invoices/expenses/payments, get item) — no create/update/delete/email actions.
export const zohoInvoiceComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "ZOHO_INVOICE_LIST_INVOICES",
    description: "List invoices, with optional filters (status, customer, date range). Read-only.",
    parameters: z.object({
      page: z.number().int().optional().describe("Page number"),
      per_page: z.number().int().optional().describe("Results per page"),
      status: z.string().optional().describe("Invoice status filter"),
      customer_id: z.string().optional().describe("Filter by customer ID"),
      search_text: z.string().optional().describe("Free-text search"),
    }).passthrough(),
  },
  {
    slug: "ZOHO_INVOICE_LIST_CONTACTS",
    description: "List contacts for an organization, with optional filters. Read-only.",
    parameters: z.object({
      organization_id: z.string().describe("Zoho Invoice organization ID"),
      page: z.number().int().optional().describe("Page number"),
      per_page: z.number().int().optional().describe("Results per page"),
      search_text: z.string().optional().describe("Free-text search"),
    }).passthrough(),
  },
  {
    slug: "ZOHO_INVOICE_LIST_ITEMS",
    description: "List the item catalog for an organization. Read-only.",
    parameters: z.object({
      organization_id: z.string().describe("Zoho Invoice organization ID"),
      page: z.number().int().optional().describe("Page number"),
      per_page: z.number().int().optional().describe("Results per page"),
      search_text: z.string().optional().describe("Free-text search"),
    }).passthrough(),
  },
  {
    slug: "ZOHO_INVOICE_GET_ITEM",
    description: "Get details of a specific item. Read-only.",
    parameters: z.object({
      item_id: z.string().describe("Item ID"),
      organization_id: z.string().describe("Zoho Invoice organization ID"),
    }).passthrough(),
  },
  {
    slug: "ZOHO_INVOICE_LIST_EXPENSES",
    description: "List expenses, with pagination. Read-only.",
    parameters: z.object({
      page: z.number().int().optional().describe("Page number"),
      per_page: z.number().int().optional().describe("Results per page"),
    }).passthrough(),
  },
  {
    slug: "ZOHO_INVOICE_LIST_PAYMENTS",
    description: "List payments, with optional filters (customer, invoice, date range). Read-only.",
    parameters: z.object({
      page: z.number().int().optional().describe("Page number"),
      customer_id: z.string().optional().describe("Filter by customer ID"),
      invoice_id: z.string().optional().describe("Filter by invoice ID"),
    }).passthrough(),
  },
]

export function makeComposioZohoInvoiceDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "zoho-invoice",
    name: "Zoho Invoice",
    category: "finance",
    icon: "zoho-invoice",
    description: "Zoho Invoice — read-only reporting on invoices, contacts, items, expenses, and payments (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: ZOHO_INVOICE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_ZOHO_INVOICE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Zoho Invoice auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_ZOHO_INVOICE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=zoho-invoice to route Zoho Invoice through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_ZOHO_INVOICE_AUTH_CONFIG_ID", label: "Composio Zoho Invoice auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/zoho_invoice",
    },
    tools: createComposioTools({
      provider: "zoho-invoice",
      toolkit: ZOHO_INVOICE_TOOLKIT,
      specs: zohoInvoiceComposioSpecs,
      executor,
    }),
  }
}
