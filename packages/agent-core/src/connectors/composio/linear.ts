import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

// Composio toolkit slug — also the classification-map key.
export const LINEAR_TOOLKIT = "linear"

// The Linear actions Yomi surfaces through Composio. Slugs are Composio's action
// ids (see the risk map). Schemas allow passthrough so the model can also supply
// Composio's exact field names; Composio validates the full schema server-side.
export const linearComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "LINEAR_LIST_LINEAR_ISSUES",
    description:
      "List issues from Linear. Optionally filter by team, assignee, or state. Read-only.",
    parameters: z
      .object({
        team_id: z.string().optional().describe("Filter by team id"),
        assignee_id: z.string().optional().describe("Filter by assignee id"),
        first: z.number().int().min(1).max(50).optional().describe("Max issues to return"),
      })
      .passthrough(),
  },
  {
    slug: "LINEAR_GET_LINEAR_ISSUE",
    description: "Get full details for a specific Linear issue. Read-only.",
    parameters: z.object({ issue_id: z.string().describe("Issue id or identifier") }).passthrough(),
  },
  {
    slug: "LINEAR_LIST_LINEAR_TEAMS",
    description: "List the teams in the Linear workspace. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "LINEAR_LIST_LINEAR_PROJECTS",
    description: "List projects in the Linear workspace. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "LINEAR_LIST_LINEAR_STATES",
    description:
      "List workflow states (Todo, In Progress, Done, …) for a team. Read-only. Use before updating an issue's state.",
    parameters: z.object({ team_id: z.string().optional() }).passthrough(),
  },
  {
    slug: "LINEAR_LIST_LINEAR_LABELS",
    description: "List issue labels available in the workspace. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "LINEAR_CREATE_LINEAR_ISSUE",
    description: "Create a new Linear issue. Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().describe("Issue title"),
        description: z.string().optional().describe("Issue description (markdown)"),
        team_id: z.string().describe("Team id to create the issue in"),
        priority: z.number().int().min(0).max(4).optional().describe("0 none … 1 urgent … 4 low"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Linear issue: ${String(a["title"] ?? "")}`,
      preview: [String(a["title"] ?? ""), String(a["description"] ?? "").slice(0, 800)]
        .filter(Boolean)
        .join("\n\n"),
      confirmText: "Create issue",
    }),
  },
  {
    slug: "LINEAR_UPDATE_ISSUE",
    description:
      "Update a Linear issue's state, priority, or assignee. Requires user approval before it runs.",
    parameters: z
      .object({
        issue_id: z.string().describe("Issue id or identifier"),
        title: z.string().optional(),
        description: z.string().optional(),
        state_id: z.string().optional(),
        priority: z.number().int().min(0).max(4).optional(),
        assignee_id: z.string().optional(),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update Linear issue ${String(a["issue_id"] ?? "")}`,
      preview: JSON.stringify(a).slice(0, 800),
      confirmText: "Update issue",
    }),
  },
  {
    slug: "LINEAR_CREATE_LINEAR_COMMENT",
    description: "Add a comment to a Linear issue. Requires user approval before it runs.",
    parameters: z
      .object({
        issue_id: z.string().describe("Issue id or identifier"),
        body: z.string().describe("Comment body (markdown)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Comment on Linear issue ${String(a["issue_id"] ?? "")}`,
      preview: String(a["body"] ?? "").slice(0, 800),
      confirmText: "Post comment",
    }),
  },
  {
    slug: "LINEAR_DELETE_LINEAR_ISSUE",
    description:
      "Permanently delete a Linear issue. This CANNOT be undone. Requires user approval before it runs.",
    parameters: z.object({ issue_id: z.string().describe("Issue id or identifier") }).passthrough(),
    preview: (a) => ({
      title: `Delete Linear issue ${String(a["issue_id"] ?? "")}`,
      preview: `Permanently delete issue ${String(a["issue_id"] ?? "")}. This CANNOT be undone.`,
      confirmText: "Delete issue",
    }),
  },
]

// Build the Composio-backed Linear ConnectorDef. The executor is injected so the
// same def works in tests (fake), the live agent loop, and the approval-replay
// executor. Shape matches the native `linearDef` so the registry and connect flow
// treat it like any other connector.
export function makeComposioLinearDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "linear",
    name: "Linear",
    category: "engineering",
    icon: "linear",
    description: "List, view, create, and update Linear issues (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: LINEAR_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_LINEAR_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Linear auth config in Composio (or use the managed one)",
        "Set COMPOSIO_API_KEY and COMPOSIO_LINEAR_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=linear to route Linear through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_LINEAR_AUTH_CONFIG_ID", label: "Composio Linear auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/linear",
    },
    tools: createComposioTools({
      provider: "linear",
      toolkit: LINEAR_TOOLKIT,
      specs: linearComposioSpecs,
      executor,
    }),
  }
}
