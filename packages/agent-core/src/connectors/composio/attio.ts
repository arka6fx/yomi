import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const ATTIO_TOOLKIT = "attio"

// Real Attio catalog is generic-object CRM primitives — no dedicated
// company/person/deal-specific endpoints; records are addressed by object_type.
export const attioComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "ATTIO_LIST_OBJECTS",
    description: "List all object types (system and custom) in the Attio workspace. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "ATTIO_GET_OBJECT",
    description: "Get details of a specific object type, including its attributes. Read-only.",
    parameters: z
      .object({ object_id: z.string().describe("Object type ID or slug") })
      .passthrough(),
  },
  {
    slug: "ATTIO_LIST_RECORDS",
    description:
      "List records of a specific object type (people, companies, deals, etc.), paginated. Read-only.",
    parameters: z
      .object({
        object_type: z.string().describe("Object type, e.g. 'people', 'companies', 'deals'"),
        limit: z.number().int().optional().describe("Max results"),
        offset: z.number().int().optional().describe("Pagination offset"),
      })
      .passthrough(),
  },
  {
    slug: "ATTIO_FIND_RECORD",
    description: "Find a record by ID or by searching unique attributes. Read-only.",
    parameters: z
      .object({
        object_id: z.string().describe("Object type ID or slug"),
        record_id: z.string().optional().describe("Record ID, if known"),
        attributes: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Attribute values to search by"),
      })
      .passthrough(),
  },
  {
    slug: "ATTIO_LIST_LISTS",
    description: "List all lists in the Attio workspace. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "ATTIO_LIST_NOTES",
    description: "List notes attached to a specific record. Read-only.",
    parameters: z
      .object({
        parent_object: z.string().describe("Object type of the parent record"),
        parent_record_id: z.string().describe("Parent record ID"),
      })
      .passthrough(),
  },
  {
    slug: "ATTIO_CREATE_RECORD",
    description:
      "Create a new record for a specified object type. Requires user approval before it runs.",
    parameters: z
      .object({
        object_type: z.string().describe("Object type, e.g. 'people', 'companies', 'deals'"),
        values: z.record(z.string(), z.unknown()).describe("Attribute values for the new record"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create record",
      preview: `Create ${String(a["object_type"] ?? "")} record`,
      confirmText: "Create record",
    }),
  },
  {
    slug: "ATTIO_UPDATE_RECORD",
    description: "Update an existing record. Requires user approval before it runs.",
    parameters: z
      .object({
        object_type: z.string().describe("Object type"),
        record_id: z.string().describe("Record ID"),
        values: z.record(z.string(), z.unknown()).describe("Attribute values to update"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update record",
      preview: `Update ${String(a["object_type"] ?? "")} record ${String(a["record_id"] ?? "")}`,
      confirmText: "Update record",
    }),
  },
  {
    slug: "ATTIO_CREATE_NOTE",
    description: "Create a note on a record. Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().describe("Note title"),
        content: z.string().describe("Note content"),
        parent_object: z.string().describe("Object type of the parent record"),
        parent_record_id: z.string().describe("Parent record ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create note",
      preview: `Create note "${String(a["title"] ?? "")}"`,
      confirmText: "Create note",
    }),
  },
  {
    slug: "ATTIO_DELETE_RECORD",
    description: "Delete a record. This cannot be undone.",
    parameters: z
      .object({
        object_type: z.string().describe("Object type"),
        record_id: z.string().describe("Record ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete record",
      preview: `Delete ${String(a["object_type"] ?? "")} record ${String(a["record_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "ATTIO_DELETE_NOTE",
    description: "Delete a note. This cannot be undone.",
    parameters: z.object({ note_id: z.string().describe("Note ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete note",
      preview: `Delete note ${String(a["note_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
]

export function makeComposioAttioDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "attio",
    name: "Attio",
    category: "crm",
    icon: "attio",
    description:
      "Attio — modern CRM for relationship-driven businesses; manage records, notes, and lists across any object type (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: ATTIO_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_ATTIO_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create an Attio auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_ATTIO_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=attio to route Attio through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_ATTIO_AUTH_CONFIG_ID",
          label: "Composio Attio auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/attio",
    },
    tools: createComposioTools({
      provider: "attio",
      toolkit: ATTIO_TOOLKIT,
      specs: attioComposioSpecs,
      executor,
    }),
  }
}
