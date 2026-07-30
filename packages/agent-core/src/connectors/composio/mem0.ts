import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const MEM0_TOOLKIT = "mem0"

export const mem0ComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "MEM0_RETRIEVE_MEMORY_LIST",
    description: "List memories with pagination and filtering. Read-only.",
    parameters: z
      .object({
        user_id: z.string().optional().describe("Filter by user ID"),
        agent_id: z.string().optional().describe("Filter by agent ID"),
        page: z.number().int().optional().describe("Page number"),
      })
      .passthrough(),
  },
  {
    slug: "MEM0_RETRIEVE_MEMORY_BY_UNIQUE_IDENTIFIER",
    description: "Get a specific memory by its ID. Read-only.",
    parameters: z.object({ memory_id: z.string().describe("Memory ID") }).passthrough(),
  },
  {
    slug: "MEM0_PERFORM_SEMANTIC_SEARCH_ON_MEMORIES",
    description: "Search memories semantically using a natural-language query. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Search query"),
        user_id: z.string().optional().describe("Filter by user ID"),
        top_k: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "MEM0_RETRIEVE_MEMORY_HISTORY_BY_ID",
    description: "Get the version history of a memory. Read-only.",
    parameters: z.object({ memory_id: z.string().describe("Memory ID") }).passthrough(),
  },
  {
    slug: "MEM0_RETRIEVE_ENTITY_SPECIFIC_MEMORIES",
    description: "Get all memories for a specific entity (user, agent, app, or run). Read-only.",
    parameters: z
      .object({
        entity_id: z.string().describe("Entity ID"),
        entity_type: z.string().describe("'user', 'agent', 'app', or 'run'"),
      })
      .passthrough(),
  },
  {
    slug: "MEM0_GET_USER_MEMORY_STATS",
    description: "Get a summary of the authenticated user's memory activity. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "MEM0_GET_PROJECTS",
    description: "List projects for an organization. Read-only.",
    parameters: z.object({ org_id: z.string().describe("Organization ID") }).passthrough(),
  },
  {
    slug: "MEM0_GET_PROJECT_DETAILS",
    description: "Get details of a specific project. Read-only.",
    parameters: z
      .object({
        org_id: z.string().describe("Organization ID"),
        project_id: z.string().describe("Project ID"),
      })
      .passthrough(),
  },
  {
    slug: "MEM0_FETCH_DETAILED_LIST_OF_ORGANIZATIONS",
    description: "List organizations. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "MEM0_FETCH_DETAILS_OF_A_SPECIFIC_ORGANIZATION",
    description: "Get details of a specific organization. Read-only.",
    parameters: z.object({ org_id: z.string().describe("Organization ID") }).passthrough(),
  },
  {
    slug: "MEM0_GET_ORGANIZATION_MEMBERS",
    description: "List members of an organization. Read-only.",
    parameters: z.object({ org_id: z.string().describe("Organization ID") }).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "MEM0_ADD_NEW_MEMORY_RECORDS",
    description:
      "Store new memories from a list of messages. Requires user approval before it runs.",
    parameters: z
      .object({
        messages: z
          .array(z.record(z.string(), z.unknown()))
          .describe("Messages to extract memories from"),
        user_id: z.string().optional().describe("User ID"),
        agent_id: z.string().optional().describe("Agent ID"),
      })
      .passthrough(),
    preview: () => ({
      title: "Add memory",
      preview: "Store new memory records",
      confirmText: "Add memory",
    }),
  },
  {
    slug: "MEM0_UPDATE_MEMORY_DETAILS_BY_ID",
    description:
      "Update the text content of an existing memory. Requires user approval before it runs.",
    parameters: z
      .object({
        memory_id: z.string().describe("Memory ID"),
        text: z.string().describe("New memory text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update memory",
      preview: `Update memory ${String(a["memory_id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "MEM0_CREATE_PROJECT",
    description:
      "Create a new project within an organization. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Project name"),
        org_id: z.string().describe("Organization ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create project",
      preview: `Create project "${String(a["name"] ?? "")}"`,
      confirmText: "Create project",
    }),
  },
  {
    slug: "MEM0_ADD_ORGANIZATION_MEMBER",
    description: "Add a member to an organization. Requires user approval before it runs.",
    parameters: z
      .object({
        org_id: z.string().describe("Organization ID"),
        email: z.string().describe("Member email"),
        role: z.string().describe("Member role"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add member",
      preview: `Add ${String(a["email"] ?? "")} to org ${String(a["org_id"] ?? "")}`,
      confirmText: "Add",
    }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "MEM0_DELETE_A_SPECIFIC_MEMORY_BY_ID",
    description: "Permanently delete a specific memory. This cannot be undone.",
    parameters: z.object({ memory_id: z.string().describe("Memory ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete memory",
      preview: `Delete memory ${String(a["memory_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "MEM0_DELETE_MEMORIES_ENDPOINT",
    description: "Delete memories matching filter criteria. This cannot be undone.",
    parameters: z
      .object({
        user_id: z.string().optional().describe("Filter by user ID"),
        agent_id: z.string().optional().describe("Filter by agent ID"),
      })
      .passthrough(),
    preview: () => ({
      title: "Delete memories",
      preview: "Delete memories matching filters — this cannot be undone",
      confirmText: "Delete",
    }),
  },
  {
    slug: "MEM0_DELETE_PROJECT",
    description: "Permanently delete a project and all its data. This cannot be undone.",
    parameters: z
      .object({
        org_id: z.string().describe("Organization ID"),
        project_id: z.string().describe("Project ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete project",
      preview: `Delete project ${String(a["project_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
]

export function makeComposioMem0Def(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "mem0",
    name: "Mem0",
    category: "data",
    icon: "mem0",
    description:
      "Mem0 — store, search, and manage long-term memory for AI applications (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: MEM0_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_MEM0_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.mem0.ai/dashboard/api-keys",
      steps: [
        "Create a Mem0 auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_MEM0_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=mem0 to route Mem0 through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_MEM0_AUTH_CONFIG_ID",
          label: "Composio Mem0 auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/mem0",
    },
    tools: createComposioTools({
      provider: "mem0",
      toolkit: MEM0_TOOLKIT,
      specs: mem0ComposioSpecs,
      executor,
    }),
  }
}
