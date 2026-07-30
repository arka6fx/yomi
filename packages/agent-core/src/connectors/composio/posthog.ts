import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const POSTHOG_TOOLKIT = "posthog"

// Composio's PostHog toolkit has 500+ actions (near-total mirror of PostHog's
// REST API — organizations, pipelines, plugins, warehouse, hog functions, live
// debugger, and so on). Every single one was previously declared here with
// `parameters: z.object({}).passthrough()` — a blanket empty stub, not a
// deliberate "no params needed": the model had no field to put a project ID,
// flag key, or insight ID into, so none of the 507 were actually callable
// against PostHog's real API. Every other large connector in this catalog
// (Stripe, Salesforce, GitHub, ...) has real per-tool parameters; PostHog was
// the one outlier, generated differently from the rest.
//
// Replaced with a curated, verified-working read-only set covering what a
// product-analytics conversation actually needs — feature flags, insights,
// trends, retention, cohorts, dashboards, surveys, experiments, session
// recordings, event definitions — each schema
// pulled from Composio's real tool metadata (not guessed). Write actions
// (create/update a feature flag, etc.) are deliberately left out for now: the
// "manage" slugs Composio exposes were ambiguous about whether they're a
// single multi-purpose endpoint or genuinely need a create-shaped payload, and
// shipping a guessed write schema is worse than not having the tool yet.
export const posthogComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "POSTHOG_LIST_AND_MANAGE_PROJECT_FEATURE_FLAGS",
    description: "List feature flags for a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        limit: z.number().int().optional().describe("Max results per page"),
        offset: z.number().int().optional().describe("Pagination offset"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_PROJECT_INSIGHTS_WITH_PAGINATION",
    description: "List insights (saved analyses/charts) in a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        limit: z.number().int().optional().describe("Max results per page"),
        offset: z.number().int().optional().describe("Pagination offset"),
        format: z.string().optional().describe("'csv' or 'json'"),
        short_id: z.string().optional().describe("Filter by insight short ID"),
        created_by: z.number().int().optional().describe("Filter by creator user ID"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_PROJECT_INSIGHT_DETAILS",
    description: "Get a specific insight's details, results, and metadata. Read-only.",
    parameters: z
      .object({
        id: z.number().int().describe("Insight ID"),
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        format: z.string().optional().describe("'csv' or 'json'"),
        refresh: z.boolean().optional().describe("Ask the server to refresh cached results"),
        from_dashboard: z
          .number()
          .int()
          .optional()
          .describe("Dashboard ID for dashboard-scoped context"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_PROJECT_TREND_INSIGHTS",
    description: "Get trend insights (metrics over time) for a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        format: z.string().optional().describe("'csv' or 'json'"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_RETENTION_INSIGHTS",
    description: "Get retention insights for a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        format: z.string().optional().describe("'csv' or 'json'"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_PROJECT_COHORTS_WITH_PAGINATION",
    description: "List cohorts in a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        limit: z.number().int().optional().describe("Max results per page"),
        offset: z.number().int().optional().describe("Pagination offset"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_PROJECT_COHORT_DETAILS",
    description: "Get a specific cohort's details (name, creator, status). Read-only.",
    parameters: z
      .object({
        id: z.number().int().describe("Cohort ID"),
        project_id: z.string().describe("Project ID (from /api/projects/)"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_LIST_PROJECT_DASHBOARDS_WITH_PAGINATION",
    description: "List dashboards in a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        limit: z.number().int().optional().describe("Max results per page"),
        offset: z.number().int().optional().describe("Pagination offset"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_SPECIFIC_PROJECT_DASHBOARD_DETAILS",
    description: "Get a specific dashboard's details (owner, access, layout). Read-only.",
    parameters: z
      .object({
        id: z.number().int().describe("Dashboard ID"),
        project_id: z.string().describe("Project ID (from /api/projects/)"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_LIST_PAGINATED_SURVEYS_FOR_A_PROJECT",
    description: "List surveys in a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        limit: z.number().int().optional().describe("Max results per page"),
        offset: z.number().int().optional().describe("Pagination offset"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_LIST_PROJECT_EXPERIMENTS_WITH_PAGINATION",
    description: "List experiments (A/B tests) in a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        limit: z.number().int().optional().describe("Max results per page"),
        offset: z.number().int().optional().describe("Pagination offset"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_LIST_PROJECT_SESSION_RECORDINGS",
    description: "List session recordings for a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
        limit: z.number().int().optional().describe("Max results per page"),
        offset: z.number().int().optional().describe("Pagination offset"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_EVENT_DEFINITIONS_BY_PROJECT_ID",
    description: "List event definitions (the event catalog) for a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID (from /api/projects/)"),
      })
      .passthrough(),
  },
  {
    slug: "POSTHOG_RETRIEVE_EVENT_DEFINITION_BY_UUID",
    description: "Get a specific event definition by its UUID. Read-only.",
    parameters: z
      .object({
        id: z.string().describe("Event definition UUID"),
        project_id: z.string().describe("Project ID (from /api/projects/)"),
      })
      .passthrough(),
  },
]

export function makeComposioPostHogDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "posthog",
    name: "PostHog",
    category: "data-analytics",
    icon: "posthog",
    description:
      "PostHog — product analytics, feature flags, session recordings, funnels, event tracking, and data insights (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: POSTHOG_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_POSTHOG_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a PostHog auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_POSTHOG_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=posthog to route PostHog through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_POSTHOG_AUTH_CONFIG_ID",
          label: "Composio PostHog auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/posthog",
    },
    tools: createComposioTools({
      provider: "posthog",
      toolkit: POSTHOG_TOOLKIT,
      specs: posthogComposioSpecs,
      executor,
    }),
  }
}
