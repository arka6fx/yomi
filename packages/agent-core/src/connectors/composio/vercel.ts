import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const VERCEL_TOOLKIT = "vercel"

export const vercelComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "VERCEL_GET_PROJECT", description: "Get details of a Vercel project. Read-only.", parameters: z.object({ projectIdOrName: z.string().describe("Project ID or name"), teamId: z.string().optional().describe("Team ID") }).passthrough() },
  { slug: "VERCEL_LIST_ALL_DEPLOYMENTS", description: "List deployments for the user or team. Read-only.", parameters: z.object({ projectId: z.string().optional().describe("Filter by project"), limit: z.number().int().optional().describe("Max results"), teamId: z.string().optional().describe("Team ID") }).passthrough() },
  { slug: "VERCEL_GET_DEPLOYMENT_DETAILS", description: "Get details of a specific deployment. Read-only.", parameters: z.object({ idOrUrl: z.string().describe("Deployment ID or URL"), teamId: z.string().optional().describe("Team ID") }).passthrough() },
  { slug: "VERCEL_GET_DEPLOYMENT_EVENTS", description: "Get build/runtime events for a deployment. Read-only.", parameters: z.object({ idOrUrl: z.string().describe("Deployment ID or URL"), teamId: z.string().optional().describe("Team ID") }).passthrough() },
  { slug: "VERCEL_GET_DEPLOYMENT_LOGS", description: "Get logs for a deployment. Read-only.", parameters: z.object({ idOrUrl: z.string().describe("Deployment ID or URL"), teamId: z.string().optional().describe("Team ID") }).passthrough() },
  { slug: "VERCEL_LIST_DEPLOYMENT_CHECKS", description: "List checks run against a deployment. Read-only.", parameters: z.object({ deploymentId: z.string().describe("Deployment ID"), teamId: z.string().optional().describe("Team ID") }).passthrough() },
  { slug: "VERCEL_LIST_ENV_VARIABLES", description: "List environment variables for a project. Read-only.", parameters: z.object({ projectId: z.string().describe("Project ID") }).passthrough() },
  { slug: "VERCEL_LIST_TEAMS", description: "List teams accessible to the authenticated user. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "VERCEL_LIST_ALIASES", description: "List domain aliases for the user or team. Read-only.", parameters: z.object({ teamId: z.string().optional().describe("Team ID"), projectId: z.string().optional().describe("Filter by project") }).passthrough() },
  { slug: "VERCEL_LIST_AUTH_TOKENS", description: "List authentication tokens for the current user. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "VERCEL_CHECK_DOMAIN_AVAILABILITY", description: "Check whether a domain is available for registration. Read-only.", parameters: z.object({ name: z.string().describe("Domain name") }).passthrough() },
  { slug: "VERCEL_LIST_EDGE_CONFIGS", description: "List Edge Config stores. Read-only.", parameters: z.object({ teamId: z.string().optional().describe("Team ID") }).passthrough() },
  { slug: "VERCEL_LIST_EDGE_CONFIG_ITEMS", description: "List items in an Edge Config store. Read-only.", parameters: z.object({ edgeConfigId: z.string().describe("Edge Config ID") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "VERCEL_CREATE_NEW_DEPLOYMENT",
    description: "Create a new deployment for a project. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().optional().describe("Deployment name"), project: z.string().optional().describe("Project ID or name"), target: z.string().optional().describe("'production' or 'preview'") }).passthrough(),
    preview: (a) => ({ title: "Create deployment", preview: `Deploy ${String(a["project"] ?? a["name"] ?? "")}`, confirmText: "Deploy" }),
  },
  {
    slug: "VERCEL_ADD_ENVIRONMENT_VARIABLE",
    description: "Add an environment variable to a project. Requires user approval before it runs.",
    parameters: z.object({ idOrName: z.string().describe("Project ID or name"), key: z.string().describe("Variable name"), value: z.string().describe("Variable value"), type: z.string().describe("'plain', 'secret', or 'encrypted'"), target: z.array(z.string()).describe("Environments: 'production', 'preview', 'development'") }).passthrough(),
    preview: (a) => ({ title: "Add env variable", preview: `Add ${String(a["key"] ?? "")}`, confirmText: "Add" }),
  },
  {
    slug: "VERCEL_UPDATE_PROJECT",
    description: "Update a Vercel project's configuration. Requires user approval before it runs.",
    parameters: z.object({ idOrName: z.string().describe("Project ID or name") }).passthrough(),
    preview: (a) => ({ title: "Update project", preview: `Update project ${String(a["idOrName"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "VERCEL_CREATE_AUTH_TOKEN",
    description: "Create a new authentication token. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Token name") }).passthrough(),
    preview: (a) => ({ title: "Create token", preview: `Create token "${String(a["name"] ?? "")}"`, confirmText: "Create token" }),
  },
  {
    slug: "VERCEL_CREATE_EDGE_CONFIG",
    description: "Create a new Edge Config store for a project. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Edge Config name"), slug: z.string().describe("Edge Config slug"), projectId: z.string().describe("Project ID") }).passthrough(),
    preview: (a) => ({ title: "Create edge config", preview: `Create edge config "${String(a["name"] ?? "")}"`, confirmText: "Create" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "VERCEL_DELETE_DEPLOYMENT",
    description: "Delete a specific deployment. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Deployment ID") }).passthrough(),
    preview: (a) => ({ title: "Delete deployment", preview: `Delete deployment ${String(a["id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "VERCEL_DELETE_PROJECT",
    description: "Permanently delete a project. This cannot be undone.",
    parameters: z.object({ id: z.string().describe("Project ID or name") }).passthrough(),
    preview: (a) => ({ title: "Delete project", preview: `Delete project ${String(a["id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "VERCEL_DELETE_ENVIRONMENT_VARIABLE",
    description: "Delete an environment variable from a project. This cannot be undone.",
    parameters: z.object({ idOrName: z.string().describe("Project ID or name"), id: z.string().describe("Environment variable ID") }).passthrough(),
    preview: (a) => ({ title: "Delete env variable", preview: `Delete env var ${String(a["id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "VERCEL_DELETE_AUTH_TOKEN",
    description: "Revoke an authentication token. This cannot be undone.",
    parameters: z.object({ tokenId: z.string().describe("Token ID") }).passthrough(),
    preview: (a) => ({ title: "Delete token", preview: `Revoke token ${String(a["tokenId"] ?? "")} — this cannot be undone`, confirmText: "Revoke" }),
  },
]

export function makeComposioVercelDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "vercel",
    name: "Vercel",
    category: "developer",
    icon: "vercel",
    description: "Vercel — frontend deployment platform: projects, deployments, domains, edge config, and environment variables (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: VERCEL_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_VERCEL_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://vercel.com/account/tokens",
      steps: [
        "Create a Vercel auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_VERCEL_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=vercel to route Vercel through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_VERCEL_AUTH_CONFIG_ID", label: "Composio Vercel auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/vercel",
    },
    tools: createComposioTools({
      provider: "vercel",
      toolkit: VERCEL_TOOLKIT,
      specs: vercelComposioSpecs,
      executor,
    }),
  }
}
