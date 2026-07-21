import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

// Composio's real toolkit slug is "dynamics365" (no underscore) — verified
// against the live tools catalog, not "dynamics_365".
export const DYNAMICS_365_TOOLKIT = "dynamics365"

// Real Dynamics 365 catalog is much smaller than assumed: create/update for
// account/case/contact/invoice/lead/opportunity/sales-order, plus a handful of
// gets — no delete actions, no list-accounts/contacts/opportunities, no search.
export const dynamics365ComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "DYNAMICS365_DYNAMICSCRM_GET_A_LEAD",
    description: "Get details of a specific Dynamics 365 lead. Read-only.",
    parameters: z.object({ lead_id: z.string().describe("Lead ID") }).passthrough(),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_GET_ALL_LEADS",
    description: "List Dynamics 365 leads. Read-only.",
    parameters: z.object({ filter: z.string().optional().describe("OData filter expression") }).passthrough(),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_GET_A_INVOICE",
    description: "Get details of a specific Dynamics 365 invoice. Read-only.",
    parameters: z.object({ invoice_id: z.string().describe("Invoice ID") }).passthrough(),
  },
  {
    slug: "DYNAMICS365_DYNAMICS365_GET_ALL_INVOICES_ACTION",
    description: "List Dynamics 365 invoices. Read-only.",
    parameters: z.object({ filter: z.string().optional().describe("OData filter expression") }).passthrough(),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_CREATE_ACCOUNT",
    description: "Create a new Dynamics 365 account. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().optional().describe("Account name") }).passthrough(),
    preview: (a) => ({ title: "Create account", preview: `Create account "${String(a["name"] ?? "")}"`, confirmText: "Create account" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_CREATE_CONTACT",
    description: "Create a new Dynamics 365 contact. Requires user approval before it runs.",
    parameters: z.object({ firstname: z.string().optional().describe("First name"), lastname: z.string().optional().describe("Last name") }).passthrough(),
    preview: (a) => ({ title: "Create contact", preview: `Create contact ${String(a["firstname"] ?? "")} ${String(a["lastname"] ?? "")}`, confirmText: "Create contact" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_CREATE_LEAD",
    description: "Create a new Dynamics 365 lead. Requires user approval before it runs.",
    parameters: z.object({ subject: z.string().optional().describe("Lead subject"), lastname: z.string().optional().describe("Last name"), companyname: z.string().optional().describe("Company name") }).passthrough(),
    preview: (a) => ({ title: "Create lead", preview: `Create lead ${String(a["lastname"] ?? "")} at ${String(a["companyname"] ?? "")}`, confirmText: "Create lead" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_CREATE_OPPORTUNITY",
    description: "Create a new Dynamics 365 opportunity. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().optional().describe("Opportunity name"), estimatedvalue: z.number().optional().describe("Estimated value") }).passthrough(),
    preview: (a) => ({ title: "Create opportunity", preview: `Create opportunity "${String(a["name"] ?? "")}"`, confirmText: "Create opportunity" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_CREATE_CASE",
    description: "Create a new Dynamics 365 case (incident). Requires user approval before it runs.",
    parameters: z.object({ title: z.string().optional().describe("Case title") }).passthrough(),
    preview: (a) => ({ title: "Create case", preview: `Create case "${String(a["title"] ?? "")}"`, confirmText: "Create case" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_CREATE_INVOICE",
    description: "Create a new Dynamics 365 invoice. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().optional().describe("Invoice name"), account_id: z.string().optional().describe("Account ID") }).passthrough(),
    preview: (a) => ({ title: "Create invoice", preview: `Create invoice "${String(a["name"] ?? "")}"`, confirmText: "Create invoice" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_CREATE_SALES_ORDER",
    description: "Create a new Dynamics 365 sales order. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().optional().describe("Sales order name"), account_id: z.string().optional().describe("Account ID") }).passthrough(),
    preview: (a) => ({ title: "Create sales order", preview: `Create sales order "${String(a["name"] ?? "")}"`, confirmText: "Create sales order" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_UPDATE_LEAD",
    description: "Update an existing Dynamics 365 lead. Requires user approval before it runs.",
    parameters: z.object({ lead_id: z.string().describe("Lead ID") }).passthrough(),
    preview: (a) => ({ title: "Update lead", preview: `Update lead ${String(a["lead_id"] ?? "")}`, confirmText: "Update lead" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_UPDATE_OPPORTUNITY",
    description: "Update an existing Dynamics 365 opportunity. Requires user approval before it runs.",
    parameters: z.object({ opportunity_id: z.string().describe("Opportunity ID") }).passthrough(),
    preview: (a) => ({ title: "Update opportunity", preview: `Update opportunity ${String(a["opportunity_id"] ?? "")}`, confirmText: "Update opportunity" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_UPDATE_CASE",
    description: "Update an existing Dynamics 365 case. Requires user approval before it runs.",
    parameters: z.object({ case_id: z.string().describe("Case ID") }).passthrough(),
    preview: (a) => ({ title: "Update case", preview: `Update case ${String(a["case_id"] ?? "")}`, confirmText: "Update case" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_UPDATE_INVOICE",
    description: "Update an existing Dynamics 365 invoice. Requires user approval before it runs.",
    parameters: z.object({ invoice_id: z.string().describe("Invoice ID") }).passthrough(),
    preview: (a) => ({ title: "Update invoice", preview: `Update invoice ${String(a["invoice_id"] ?? "")}`, confirmText: "Update invoice" }),
  },
  {
    slug: "DYNAMICS365_DYNAMICSCRM_UPDATE_SALES_ORDER",
    description: "Update an existing Dynamics 365 sales order. Requires user approval before it runs.",
    parameters: z.object({ salesorder_id: z.string().describe("Sales order ID") }).passthrough(),
    preview: (a) => ({ title: "Update sales order", preview: `Update sales order ${String(a["salesorder_id"] ?? "")}`, confirmText: "Update sales order" }),
  },
]

export function makeComposioDynamics365Def(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "dynamics-365",
    name: "Dynamics 365",
    category: "crm",
    icon: "dynamics-365",
    description: "Microsoft Dynamics 365 — create and update accounts, contacts, leads, opportunities, cases, invoices, and sales orders (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: DYNAMICS_365_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_DYNAMICS_365_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Dynamics 365 auth config in Composio (uses OAuth2 with Microsoft Entra ID)",
        "Set COMPOSIO_API_KEY and COMPOSIO_DYNAMICS_365_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=dynamics-365 to route Dynamics 365 through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_DYNAMICS_365_AUTH_CONFIG_ID", label: "Composio Dynamics 365 auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/dynamics365",
    },
    tools: createComposioTools({
      provider: "dynamics-365",
      toolkit: DYNAMICS_365_TOOLKIT,
      specs: dynamics365ComposioSpecs,
      executor,
    }),
  }
}
