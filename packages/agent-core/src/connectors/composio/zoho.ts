import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const ZOHO_TOOLKIT = "zoho"

// Real Zoho CRM catalog is generic module-based CRUD (records are addressed by
// module_api_name, e.g. 'Leads', 'Deals', 'Contacts') — no resource-specific
// endpoints like get-account/list-deals/search-contacts.
export const zohoComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "ZOHO_GET_ZOHO_RECORDS",
    description:
      "Retrieve records from a Zoho CRM module (e.g. 'Leads', 'Deals', 'Contacts'). Read-only.",
    parameters: z
      .object({
        module_api_name: z.string().describe("Module API name, e.g. 'Leads', 'Deals', 'Contacts'"),
        ids: z.string().optional().describe("Comma-separated record IDs"),
        page: z.number().int().optional().describe("Page number"),
        per_page: z.number().int().optional().describe("Results per page"),
        fields: z.string().optional().describe("Comma-separated field names to return"),
      })
      .passthrough(),
  },
  {
    slug: "ZOHO_CREATE_ZOHO_RECORD",
    description: "Create new records in a Zoho CRM module. Requires user approval before it runs.",
    parameters: z
      .object({
        module_api_name: z.string().describe("Module API name, e.g. 'Leads', 'Deals', 'Contacts'"),
        data: z.array(z.record(z.string(), z.unknown())).describe("Records to create"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create Zoho record",
      preview: `Create record(s) in ${String(a["module_api_name"] ?? "")}`,
      confirmText: "Create",
    }),
  },
  {
    slug: "ZOHO_UPDATE_ZOHO_RECORD",
    description:
      "Update existing records in a Zoho CRM module. Requires user approval before it runs.",
    parameters: z
      .object({
        module_api_name: z.string().describe("Module API name"),
        data: z
          .array(z.record(z.string(), z.unknown()))
          .describe("Records to update (must include id)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update Zoho record",
      preview: `Update record(s) in ${String(a["module_api_name"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "ZOHO_UPDATE_RELATED_RECORDS",
    description:
      "Associate or update relationships between records across modules. Requires user approval before it runs.",
    parameters: z
      .object({
        module_api_name: z.string().describe("Source module API name"),
        record_id: z.string().describe("Source record ID"),
        related_list_api_name: z.string().describe("Related list API name"),
        data: z.array(z.record(z.string(), z.unknown())).describe("Related record links"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update related records",
      preview: `Link records to ${String(a["module_api_name"] ?? "")} ${String(a["record_id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "ZOHO_CREATE_ZOHO_TAG",
    description: "Create new tags in a Zoho CRM module. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Tag name"),
        module_api_name: z.string().optional().describe("Module API name to scope the tag to"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create tag",
      preview: `Create tag "${String(a["name"] ?? "")}"`,
      confirmText: "Create tag",
    }),
  },
  {
    slug: "ZOHO_CONVERT_ZOHO_LEAD",
    description:
      "Convert a lead into a contact, account, and optionally a deal. Requires user approval before it runs.",
    parameters: z
      .object({
        lead_id: z.string().describe("Lead ID to convert"),
        account_id: z
          .string()
          .optional()
          .describe("Existing account to attach to, instead of creating one"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Convert lead",
      preview: `Convert lead ${String(a["lead_id"] ?? "")}`,
      confirmText: "Convert",
    }),
  },
]

export function makeComposioZohoDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "zoho",
    name: "Zoho CRM",
    category: "crm",
    icon: "zoho",
    description:
      "Zoho CRM — generic module-based record management: create, update, link, and convert leads/deals/contacts/custom modules (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: ZOHO_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_ZOHO_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Zoho auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_ZOHO_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=zoho to route Zoho through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_ZOHO_AUTH_CONFIG_ID",
          label: "Composio Zoho auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/zoho",
    },
    tools: createComposioTools({
      provider: "zoho",
      toolkit: ZOHO_TOOLKIT,
      specs: zohoComposioSpecs,
      executor,
    }),
  }
}
