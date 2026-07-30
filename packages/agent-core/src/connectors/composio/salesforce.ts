import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const SALESFORCE_TOOLKIT = "salesforce"

// Curated subset of Salesforce's real ~97-tool catalog (accounts, contacts,
// leads, opportunities, campaigns, tasks, SOQL). Salesforce's catalog has many
// duplicate/legacy-named variants per resource (e.g. GET_ACCOUNT vs
// FETCH_ACCOUNT_BY_ID_WITH_QUERY) — this picks the canonical, cleanly-named one.
export const salesforceComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "SALESFORCE_GET_ACCOUNT",
    description: "Get details of a specific account. Read-only.",
    parameters: z.object({ id: z.string().describe("Account ID") }).passthrough(),
  },
  {
    slug: "SALESFORCE_LIST_ACCOUNTS",
    description: "List accounts. Read-only.",
    parameters: z
      .object({ limit: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "SALESFORCE_GET_CONTACT",
    description: "Get details of a specific contact. Read-only.",
    parameters: z.object({ id: z.string().describe("Contact ID") }).passthrough(),
  },
  {
    slug: "SALESFORCE_LIST_CONTACTS",
    description: "List contacts. Read-only.",
    parameters: z
      .object({ limit: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "SALESFORCE_GET_LEAD",
    description: "Get details of a specific lead. Read-only.",
    parameters: z.object({ id: z.string().describe("Lead ID") }).passthrough(),
  },
  {
    slug: "SALESFORCE_LIST_LEADS",
    description: "List leads. Read-only.",
    parameters: z
      .object({ limit: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "SALESFORCE_GET_OPPORTUNITY",
    description: "Get details of a specific opportunity. Read-only.",
    parameters: z.object({ id: z.string().describe("Opportunity ID") }).passthrough(),
  },
  {
    slug: "SALESFORCE_LIST_OPPORTUNITIES",
    description: "List opportunities. Read-only.",
    parameters: z
      .object({ limit: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "SALESFORCE_GET_CAMPAIGN",
    description: "Get details of a specific campaign. Read-only.",
    parameters: z.object({ id: z.string().describe("Campaign ID") }).passthrough(),
  },
  {
    slug: "SALESFORCE_LIST_CAMPAIGNS",
    description: "List campaigns. Read-only.",
    parameters: z
      .object({ limit: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "SALESFORCE_GET_NOTE",
    description: "Get details of a specific note. Read-only.",
    parameters: z.object({ id: z.string().describe("Note ID") }).passthrough(),
  },
  {
    slug: "SALESFORCE_LIST_NOTES",
    description: "List notes. Read-only.",
    parameters: z
      .object({ limit: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "SALESFORCE_RUN_SOQL_QUERY",
    description: "Run a SOQL query against Salesforce data. Read-only.",
    parameters: z.object({ query: z.string().describe("SOQL query") }).passthrough(),
  },
  {
    slug: "SALESFORCE_GET_USER_INFO",
    description: "Get the authenticated user's Salesforce info. Read-only.",
    parameters: z.object({}).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "SALESFORCE_CREATE_ACCOUNT",
    description: "Create a new account. Requires user approval before it runs.",
    parameters: z.object({ Name: z.string().describe("Account name") }).passthrough(),
    preview: (a) => ({
      title: "Create account",
      preview: `Create account "${String(a["Name"] ?? "")}"`,
      confirmText: "Create account",
    }),
  },
  {
    slug: "SALESFORCE_UPDATE_ACCOUNT",
    description: "Update an existing account. Requires user approval before it runs.",
    parameters: z.object({ id: z.string().describe("Account ID") }).passthrough(),
    preview: (a) => ({
      title: "Update account",
      preview: `Update account ${String(a["id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "SALESFORCE_CREATE_CONTACT",
    description: "Create a new contact. Requires user approval before it runs.",
    parameters: z
      .object({
        LastName: z.string().describe("Contact last name"),
        FirstName: z.string().optional().describe("Contact first name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create contact",
      preview: `Create contact ${String(a["FirstName"] ?? "")} ${String(a["LastName"] ?? "")}`,
      confirmText: "Create contact",
    }),
  },
  {
    slug: "SALESFORCE_UPDATE_CONTACT",
    description: "Update an existing contact. Requires user approval before it runs.",
    parameters: z.object({ id: z.string().describe("Contact ID") }).passthrough(),
    preview: (a) => ({
      title: "Update contact",
      preview: `Update contact ${String(a["id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "SALESFORCE_CREATE_LEAD",
    description: "Create a new lead. Requires user approval before it runs.",
    parameters: z
      .object({
        LastName: z.string().describe("Lead last name"),
        Company: z.string().describe("Company name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create lead",
      preview: `Create lead ${String(a["LastName"] ?? "")} at ${String(a["Company"] ?? "")}`,
      confirmText: "Create lead",
    }),
  },
  {
    slug: "SALESFORCE_UPDATE_LEAD",
    description: "Update an existing lead. Requires user approval before it runs.",
    parameters: z.object({ id: z.string().describe("Lead ID") }).passthrough(),
    preview: (a) => ({
      title: "Update lead",
      preview: `Update lead ${String(a["id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "SALESFORCE_CREATE_OPPORTUNITY",
    description: "Create a new opportunity. Requires user approval before it runs.",
    parameters: z
      .object({
        Name: z.string().describe("Opportunity name"),
        StageName: z.string().describe("Sales stage"),
        CloseDate: z.string().describe("Expected close date"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create opportunity",
      preview: `Create opportunity "${String(a["Name"] ?? "")}"`,
      confirmText: "Create opportunity",
    }),
  },
  {
    slug: "SALESFORCE_UPDATE_OPPORTUNITY",
    description: "Update an existing opportunity. Requires user approval before it runs.",
    parameters: z.object({ id: z.string().describe("Opportunity ID") }).passthrough(),
    preview: (a) => ({
      title: "Update opportunity",
      preview: `Update opportunity ${String(a["id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "SALESFORCE_CREATE_CAMPAIGN",
    description: "Create a new campaign. Requires user approval before it runs.",
    parameters: z.object({ Name: z.string().describe("Campaign name") }).passthrough(),
    preview: (a) => ({
      title: "Create campaign",
      preview: `Create campaign "${String(a["Name"] ?? "")}"`,
      confirmText: "Create campaign",
    }),
  },
  {
    slug: "SALESFORCE_ADD_CONTACT_TO_CAMPAIGN",
    description: "Add a contact to a campaign. Requires user approval before it runs.",
    parameters: z
      .object({
        campaign_id: z.string().describe("Campaign ID"),
        contact_id: z.string().describe("Contact ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add contact to campaign",
      preview: `Add contact ${String(a["contact_id"] ?? "")} to campaign ${String(a["campaign_id"] ?? "")}`,
      confirmText: "Add",
    }),
  },
  {
    slug: "SALESFORCE_CREATE_NOTE",
    description: "Create a note attached to a record. Requires user approval before it runs.",
    parameters: z
      .object({
        Title: z.string().describe("Note title"),
        Body: z.string().optional().describe("Note content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create note",
      preview: `Create note "${String(a["Title"] ?? "")}"`,
      confirmText: "Create note",
    }),
  },
  {
    slug: "SALESFORCE_CREATE_TASK",
    description: "Create a new task. Requires user approval before it runs.",
    parameters: z.object({ Subject: z.string().describe("Task subject") }).passthrough(),
    preview: (a) => ({
      title: "Create task",
      preview: `Create task "${String(a["Subject"] ?? "")}"`,
      confirmText: "Create task",
    }),
  },
  {
    slug: "SALESFORCE_SEND_EMAIL",
    description: "Send an email through Salesforce. Requires user approval before it runs.",
    parameters: z
      .object({ subject: z.string().optional().describe("Email subject") })
      .passthrough(),
    preview: () => ({
      title: "Send email",
      preview: "Send email via Salesforce",
      confirmText: "Send",
    }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "SALESFORCE_DELETE_ACCOUNT",
    description: "Permanently delete an account. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Account ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete account",
      preview: `Delete account ${String(a["id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "SALESFORCE_DELETE_CONTACT",
    description: "Permanently delete a contact. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Contact ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete contact",
      preview: `Delete contact ${String(a["id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "SALESFORCE_DELETE_LEAD",
    description: "Permanently delete a lead. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Lead ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete lead",
      preview: `Delete lead ${String(a["id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "SALESFORCE_DELETE_OPPORTUNITY",
    description: "Permanently delete an opportunity. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Opportunity ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete opportunity",
      preview: `Delete opportunity ${String(a["id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "SALESFORCE_DELETE_CAMPAIGN",
    description: "Permanently delete a campaign. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Campaign ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete campaign",
      preview: `Delete campaign ${String(a["id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
]

export function makeComposioSalesforceDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "salesforce",
    name: "Salesforce",
    category: "crm",
    icon: "salesforce",
    description:
      "Salesforce — manage accounts, contacts, leads, opportunities, campaigns, notes, and tasks; run SOQL queries (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: SALESFORCE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SALESFORCE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Salesforce auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_SALESFORCE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=salesforce to route Salesforce through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_SALESFORCE_AUTH_CONFIG_ID",
          label: "Composio Salesforce auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/salesforce",
    },
    tools: createComposioTools({
      provider: "salesforce",
      toolkit: SALESFORCE_TOOLKIT,
      specs: salesforceComposioSpecs,
      executor,
    }),
  }
}
