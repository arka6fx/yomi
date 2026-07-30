import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const NEON_TOOLKIT = "neon"

// Neon's Composio toolkit is control-plane only (projects/branches/endpoints/
// connection strings) — there is no data-plane "run SQL" action.
export const neonComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "NEON_RETRIEVE_PROJECTS_LIST",
    description: "List all Neon projects for the authenticated account. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().optional().describe("Max results"),
        search: z.string().optional().describe("Filter by project name/id"),
      })
      .passthrough(),
  },
  {
    slug: "NEON_ACCESS_PROJECT_DETAILS_BY_ID",
    description: "Get details of a specific Neon project. Read-only.",
    parameters: z.object({ project_id: z.string().describe("Neon project ID") }).passthrough(),
  },
  {
    slug: "NEON_GET_BRANCHES_FOR_PROJECT",
    description: "List branches for a Neon project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Neon project ID"),
        search: z.string().optional().describe("Filter by branch name"),
      })
      .passthrough(),
  },
  {
    slug: "NEON_FETCH_DATABASE_FOR_BRANCH",
    description: "List databases in a Neon branch. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Neon project ID"),
        branch_id: z.string().describe("Branch ID"),
      })
      .passthrough(),
  },
  {
    slug: "NEON_GET_PROJECT_ENDPOINT_INFORMATION",
    description: "List compute endpoints for a Neon project. Read-only.",
    parameters: z.object({ project_id: z.string().describe("Neon project ID") }).passthrough(),
  },
  {
    slug: "NEON_GET_PROJECT_CONNECTION_URI",
    description: "Get the PostgreSQL connection URI for a branch/database. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Neon project ID"),
        database_name: z.string().describe("Database name"),
        role_name: z.string().describe("Database role name"),
        branch_id: z
          .string()
          .optional()
          .describe("Branch ID (defaults to the project's default branch)"),
        pooled: z.boolean().optional().describe("Use the pooled connection endpoint"),
      })
      .passthrough(),
  },
  {
    slug: "NEON_RETRIEVE_PROJECT_OPERATIONS",
    description: "List recent operations (create/restart/restore, etc.) for a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Neon project ID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "NEON_CREATE_PROJECT_WITH_QUOTA_AND_SETTINGS",
    description: "Create a new Neon project. Requires approval.",
    parameters: z
      .object({
        project__name: z.string().optional().describe("Project name"),
        project__region__id: z.string().optional().describe("Region ID (e.g. 'aws-us-east-1')"),
        project__pg__version: z.number().int().optional().describe("Postgres major version"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Neon project ${String(a["project__name"] ?? "")}`,
      preview: `Create project "${String(a["project__name"] ?? "")}"`,
      confirmText: "Create project",
    }),
  },
  {
    slug: "NEON_CREATE_NEW_PROJECT_BRANCH",
    description: "Create a new branch in a Neon project. Requires approval.",
    parameters: z.object({ project_id: z.string().describe("Neon project ID") }).passthrough(),
    preview: (a) => ({
      title: "Create Neon branch",
      preview: `Create a new branch in project ${String(a["project_id"] ?? "")}`,
      confirmText: "Create branch",
    }),
  },
  {
    slug: "NEON_DELETE_PROJECT_BY_ID",
    description: "Delete a Neon project. Irreversible.",
    parameters: z.object({ project_id: z.string().describe("Neon project ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete Neon project",
      preview: `Delete project ${String(a["project_id"] ?? "")}`,
      confirmText: "Delete project",
    }),
  },
]

export function makeComposioNeonDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "neon",
    name: "Neon",
    category: "developer",
    icon: "neon",
    description:
      "Neon — serverless Postgres project/branch management and connection strings (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: NEON_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_NEON_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://console.neon.tech",
      steps: [
        "Create a Neon auth config in Composio with your Neon API key",
        "Set COMPOSIO_API_KEY and COMPOSIO_NEON_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=neon to route Neon through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_NEON_AUTH_CONFIG_ID",
          label: "Composio Neon auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/neon",
    },
    tools: createComposioTools({
      provider: "neon",
      toolkit: NEON_TOOLKIT,
      specs: neonComposioSpecs,
      executor,
    }),
  }
}
