import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const SUPABASE_TOOLKIT = "supabase"

// Curated subset of Supabase's real 79-tool catalog: project/branch/function/
// bucket/secret management plus SQL execution. Full catalog also covers SSO,
// third-party auth, vanity domains, and Postgres tuning — omitted here as
// niche/admin-only.
export const supabaseComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "SUPABASE_LIST_ALL_PROJECTS",
    description: "List all Supabase projects for the authenticated account. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "SUPABASE_LIST_ALL_ORGANIZATIONS",
    description: "List all organizations for the account. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "SUPABASE_GET_PROJECT_API_KEYS",
    description: "Get API keys for a project. Read-only.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
  },
  {
    slug: "SUPABASE_GETS_PROJECT_S_SERVICE_HEALTH_STATUS",
    description: "Get the health status of a project's services. Read-only.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        services: z.array(z.string()).describe("Services to check"),
      })
      .passthrough(),
  },
  {
    slug: "SUPABASE_RETURNS_PROJECT_S_READONLY_MODE_STATUS",
    description: "Check whether a project's database is in read-only mode. Read-only.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
  },
  {
    slug: "SUPABASE_GET_TABLE_SCHEMAS",
    description: "Get column details, types, and constraints for database tables. Read-only.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        table_names: z.array(z.string()).describe("Table names to inspect"),
      })
      .passthrough(),
  },
  {
    slug: "SUPABASE_GENERATE_TYPE_SCRIPT_TYPES",
    description: "Generate TypeScript types from a project's database schema. Read-only.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        included_schemas: z.string().optional().describe("Comma-separated schema names"),
      })
      .passthrough(),
  },
  {
    slug: "SUPABASE_LIST_ALL_DATABASE_BRANCHES",
    description: "List database branches for a project. Read-only.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
  },
  {
    slug: "SUPABASE_GET_DATABASE_BRANCH_CONFIG",
    description: "Get configuration and status of a database branch. Read-only.",
    parameters: z.object({ branch_id: z.string().describe("Branch ID") }).passthrough(),
  },
  {
    slug: "SUPABASE_LIST_ALL_FUNCTIONS",
    description: "List edge functions in a project. Read-only.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
  },
  {
    slug: "SUPABASE_RETRIEVE_A_FUNCTION",
    description: "Get details of a specific edge function. Read-only.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        function_slug: z.string().describe("Function slug"),
      })
      .passthrough(),
  },
  {
    slug: "SUPABASE_RETRIEVE_A_FUNCTION_BODY",
    description: "Get the source code of an edge function. Read-only.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        function_slug: z.string().describe("Function slug"),
      })
      .passthrough(),
  },
  {
    slug: "SUPABASE_LISTS_ALL_BUCKETS",
    description: "List storage buckets in a project. Read-only.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
  },
  {
    slug: "SUPABASE_LIST_ALL_SECRETS",
    description: "List secrets for a project (values may be masked). Read-only.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
  },
  {
    slug: "SUPABASE_LISTS_ALL_BACKUPS",
    description: "List database backups for a project. Read-only.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
  },
  {
    slug: "SUPABASE_LISTS_SQL_SNIPPETS_FOR_THE_LOGGED_IN_USER",
    description: "List saved SQL snippets. Read-only.",
    parameters: z
      .object({ project_ref: z.string().optional().describe("Filter by project reference ID") })
      .passthrough(),
  },
  {
    slug: "SUPABASE_GETS_A_SPECIFIC_SQL_SNIPPET",
    description: "Get a specific saved SQL snippet. Read-only.",
    parameters: z.object({ id: z.string().describe("Snippet ID") }).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "SUPABASE_BETA_RUN_SQL_QUERY",
    description:
      "Execute a SQL query against a project's database. Requires user approval before it runs.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        query: z.string().describe("SQL query to execute"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Run SQL query",
      preview: `Execute: ${String(a["query"] ?? "").slice(0, 200)}`,
      confirmText: "Run query",
    }),
  },
  {
    slug: "SUPABASE_CREATE_A_PROJECT",
    description: "Create a new Supabase project. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Project name"),
        organization_id: z.string().describe("Organization ID"),
        region: z.string().describe("Region"),
        db_pass: z.string().describe("Database password"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create project",
      preview: `Create project "${String(a["name"] ?? "")}"`,
      confirmText: "Create project",
    }),
  },
  {
    slug: "SUPABASE_CREATE_A_DATABASE_BRANCH",
    description:
      "Create a new database branch for isolated schema testing. Requires user approval before it runs.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        branch_name: z.string().describe("Branch name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create branch",
      preview: `Create branch "${String(a["branch_name"] ?? "")}"`,
      confirmText: "Create branch",
    }),
  },
  {
    slug: "SUPABASE_UPDATE_DATABASE_BRANCH_CONFIG",
    description: "Update a database branch's configuration. Requires user approval before it runs.",
    parameters: z.object({ branch_id: z.string().describe("Branch ID") }).passthrough(),
    preview: (a) => ({
      title: "Update branch",
      preview: `Update branch ${String(a["branch_id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "SUPABASE_CREATE_A_FUNCTION",
    description: "Create a new serverless edge function. Requires user approval before it runs.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        name: z.string().describe("Function name"),
        slug: z.string().describe("Function slug"),
        body: z.string().describe("Function source code"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create function",
      preview: `Create function "${String(a["name"] ?? "")}"`,
      confirmText: "Create function",
    }),
  },
  {
    slug: "SUPABASE_DEPLOY_FUNCTION",
    description: "Deploy an edge function to a project. Requires user approval before it runs.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        file: z.string().describe("Function code file content to deploy"),
        slug: z.string().optional().describe("Function slug. If omitted, deploys all functions"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Deploy function",
      preview: `Deploy function to ${String(a["ref"] ?? "")}`,
      confirmText: "Deploy",
    }),
  },
  {
    slug: "SUPABASE_UPDATE_A_FUNCTION",
    description:
      "Update an existing edge function's code or settings. Requires user approval before it runs.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        function_slug: z.string().describe("Function slug"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update function",
      preview: `Update function ${String(a["function_slug"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "SUPABASE_DISABLE_PROJECT_READONLY",
    description:
      "Temporarily disable a project's read-only mode (15 minutes) to allow writes. Requires user approval before it runs.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
    preview: (a) => ({
      title: "Disable read-only mode",
      preview: `Disable read-only for ${String(a["ref"] ?? "")}`,
      confirmText: "Disable",
    }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "SUPABASE_DELETES_THE_GIVEN_PROJECT",
    description: "Permanently delete a Supabase project. This cannot be undone.",
    parameters: z.object({ ref: z.string().describe("Project reference ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete project",
      preview: `Delete project ${String(a["ref"] ?? "")} — this cannot be undone`,
      confirmText: "Delete project",
    }),
  },
  {
    slug: "SUPABASE_DELETE_A_DATABASE_BRANCH",
    description: "Permanently delete a database branch. This cannot be undone.",
    parameters: z.object({ branch_id: z.string().describe("Branch ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete branch",
      preview: `Delete branch ${String(a["branch_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete branch",
    }),
  },
  {
    slug: "SUPABASE_DELETE_A_FUNCTION",
    description: "Permanently delete an edge function. This cannot be undone.",
    parameters: z
      .object({
        ref: z.string().describe("Project reference ID"),
        function_slug: z.string().describe("Function slug"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete function",
      preview: `Delete function ${String(a["function_slug"] ?? "")} — this cannot be undone`,
      confirmText: "Delete function",
    }),
  },
  {
    slug: "SUPABASE_RESETS_A_DATABASE_BRANCH",
    description: "Reset a database branch to its initial clean state. This cannot be undone.",
    parameters: z.object({ branch_id: z.string().describe("Branch ID") }).passthrough(),
    preview: (a) => ({
      title: "Reset branch",
      preview: `Reset branch ${String(a["branch_id"] ?? "")} — this cannot be undone`,
      confirmText: "Reset branch",
    }),
  },
]

export function makeComposioSupabaseDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "supabase",
    name: "Supabase",
    category: "developer",
    icon: "supabase",
    description:
      "Supabase — manage projects, database branches, edge functions, storage buckets, and secrets; run SQL queries (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: SUPABASE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SUPABASE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://supabase.com/dashboard/account/tokens",
      steps: [
        "Create a Supabase auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_SUPABASE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=supabase to route Supabase through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_SUPABASE_AUTH_CONFIG_ID",
          label: "Composio Supabase auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/supabase",
    },
    tools: createComposioTools({
      provider: "supabase",
      toolkit: SUPABASE_TOOLKIT,
      specs: supabaseComposioSpecs,
      executor,
    }),
  }
}
