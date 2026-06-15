import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"

async function gqlLinear<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Linear API HTTP ${res.status}`)
  const data = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (data.errors?.length) throw new Error(data.errors[0]?.message ?? "Unknown error")
  return data.data as T
}

function createLinearToolsFrom(provider: string) {
  return function createLinearTools(ctx: ConnectorContext): ToolSet {
    async function getToken(): Promise<string> {
      return ctx.getAccessToken(ctx.userId, provider)
    }

    return {
      "linear-listIssues": tool({
        description:
          "List issues from Linear. Optionally filter by team, assignee, or state. Returns up to 25 issues.",
        parameters: z.object({
          teamName: z.string().optional().describe("Filter by team name (case-insensitive partial match)"),
          assigneeMe: z.boolean().optional().describe("If true, only return issues assigned to me"),
          states: z
            .array(z.enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]))
            .optional()
            .describe("Filter by state(s)"),
          limit: z.number().int().min(1).max(25).default(15).describe("Max issues to return"),
        }),
        execute: async ({ teamName, assigneeMe, states, limit }) => {
          try {
            const token = await getToken()
            // Build filter object for GraphQL
            const filter: Record<string, unknown> = {}
            if (assigneeMe) filter.assignee = { isMe: { eq: true } }
            if (states?.length) {
              const stateMap: Record<string, string> = {
                backlog: "Backlog",
                todo: "Todo",
                in_progress: "In Progress",
                in_review: "In Review",
                done: "Done",
                cancelled: "Cancelled",
              }
              filter.state = { name: { in: states.map((s) => stateMap[s] ?? s) } }
            }
            if (teamName) filter.team = { name: { containsIgnoreCase: teamName } }

            const query = `
              query ListIssues($filter: IssueFilter, $first: Int) {
                issues(filter: $filter, first: $first, orderBy: updatedAt) {
                  nodes {
                    id
                    identifier
                    title
                    state { name }
                    assignee { name }
                    team { name }
                    priority
                    url
                    updatedAt
                  }
                }
              }
            `
            const data = await gqlLinear<{
              issues: {
                nodes: {
                  id: string
                  identifier: string
                  title: string
                  state: { name: string }
                  assignee?: { name: string }
                  team: { name: string }
                  priority: number
                  url: string
                  updatedAt: string
                }[]
              }
            }>(token, query, { filter, first: limit })

            const issues = data.issues.nodes.map((i) => ({
              id: i.id,
              identifier: i.identifier,
              title: i.title,
              state: i.state.name,
              assignee: i.assignee?.name ?? null,
              team: i.team.name,
              priority: ["No priority", "Urgent", "High", "Medium", "Low"][i.priority] ?? "Unknown",
              url: i.url,
              updatedAt: i.updatedAt,
            }))
            if (issues.length === 0) return { issues: [], message: "No issues found." }
            return { count: issues.length, issues }
          } catch (err) {
            return connectorError(err)
          }
        },
      }),

      "linear-getIssue": tool({
        description: "Get full details for a specific Linear issue by its identifier (e.g. ENG-123).",
        parameters: z.object({
          identifier: z.string().describe("Issue identifier like ENG-123"),
        }),
        execute: async ({ identifier }) => {
          try {
            const token = await getToken()
            const query = `
              query GetIssue($id: String!) {
                issue(id: $id) {
                  id
                  identifier
                  title
                  description
                  state { name }
                  assignee { name email }
                  team { name }
                  priority
                  url
                  createdAt
                  updatedAt
                  comments { nodes { body author { name } createdAt } }
                }
              }
            `
            const data = await gqlLinear<{
              issue: {
                id: string
                identifier: string
                title: string
                description?: string
                state: { name: string }
                assignee?: { name: string; email: string }
                team: { name: string }
                priority: number
                url: string
                createdAt: string
                updatedAt: string
                comments: { nodes: { body: string; author: { name: string }; createdAt: string }[] }
              }
            }>(token, query, { id: identifier })

            const i = data.issue
            return {
              id: i.id,
              identifier: i.identifier,
              title: i.title,
              description: (i.description ?? "").slice(0, 3000),
              state: i.state.name,
              assignee: i.assignee ?? null,
              team: i.team.name,
              priority: ["No priority", "Urgent", "High", "Medium", "Low"][i.priority] ?? "Unknown",
              url: i.url,
              createdAt: i.createdAt,
              updatedAt: i.updatedAt,
              comments: i.comments.nodes.slice(0, 10).map((c) => ({
                author: c.author.name,
                body: c.body.slice(0, 500),
                createdAt: c.createdAt,
              })),
            }
          } catch (err) {
            return connectorError(err)
          }
        },
      }),

      "linear-createIssue": tool({
        description: "Create a new Linear issue.",
        parameters: z.object({
          title: z.string().max(250).describe("Issue title"),
          description: z.string().optional().describe("Issue description (markdown)"),
          teamName: z.string().describe("Name of the team to create the issue in"),
          priority: z
            .enum(["urgent", "high", "medium", "low", "none"])
            .optional()
            .default("none")
            .describe("Issue priority"),
        }),
        execute: async ({ title, description, teamName, priority }) => {
          try {
            const token = await getToken()
            // First resolve team ID
            const teamQuery = `
              query GetTeam($name: String!) {
                teams(filter: { name: { containsIgnoreCase: $name } }) {
                  nodes { id name }
                }
              }
            `
            const teamData = await gqlLinear<{
              teams: { nodes: { id: string; name: string }[] }
            }>(token, teamQuery, { name: teamName })
            const team = teamData.teams.nodes[0]
            if (!team) return { error: `Team not found: ${teamName}` }

            const priorityMap: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4, none: 0 }
            const mutation = `
              mutation CreateIssue($title: String!, $teamId: String!, $description: String, $priority: Int) {
                issueCreate(input: { title: $title, teamId: $teamId, description: $description, priority: $priority }) {
                  success
                  issue { id identifier url }
                }
              }
            `
            const result = await gqlLinear<{
              issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } }
            }>(token, mutation, {
              title,
              teamId: team.id,
              description: description ?? null,
              priority: priorityMap[priority ?? "none"] ?? 0,
            })

            if (!result.issueCreate.success) return { error: "Issue creation failed" }
            return { ok: true, ...result.issueCreate.issue }
          } catch (err) {
            return connectorError(err)
          }
        },
      }),

      "linear-updateIssue": tool({
        description: "Update the state, assignee, or priority of a Linear issue.",
        parameters: z.object({
          identifier: z.string().describe("Issue identifier like ENG-123"),
          state: z.string().optional().describe("New state name (e.g. 'In Progress', 'Done')"),
          priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
        }),
        execute: async ({ identifier, state, priority }) => {
          try {
            const token = await getToken()
            const getQuery = `
              query GetIssueId($id: String!) {
                issue(id: $id) { id team { states { nodes { id name } } } }
              }
            `
            const issueData = await gqlLinear<{
              issue: { id: string; team: { states: { nodes: { id: string; name: string }[] } } }
            }>(token, getQuery, { id: identifier })
            const issue = issueData.issue

            const input: Record<string, unknown> = {}
            if (state) {
              const stateObj = issue.team.states.nodes.find(
                (s) => s.name.toLowerCase() === state.toLowerCase(),
              )
              if (!stateObj) return { error: `State not found: ${state}` }
              input.stateId = stateObj.id
            }
            if (priority) {
              const priorityMap: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4, none: 0 }
              input.priority = priorityMap[priority]
            }

            const mutation = `
              mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
                issueUpdate(id: $id, input: $input) {
                  success
                  issue { identifier url state { name } }
                }
              }
            `
            const result = await gqlLinear<{
              issueUpdate: { success: boolean; issue: { identifier: string; url: string; state: { name: string } } }
            }>(token, mutation, { id: issue.id, input })

            if (!result.issueUpdate.success) return { error: "Update failed" }
            return { ok: true, ...result.issueUpdate.issue }
          } catch (err) {
            return connectorError(err)
          }
        },
      }),
    }
  }
}

export const createLinearTools = createLinearToolsFrom("linear")
export const createLinearApiKeyTools = createLinearToolsFrom("linear-api-key")

export const linearDef: ConnectorDef = {
  id: "linear",
  name: "Linear",
  category: "engineering",
  icon: "linear",
  description: "List, view, create, and update issues in your Linear workspace via OAuth.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: ["read", "write"],
    clientIdEnv: "LINEAR_CLIENT_ID",
    clientSecretEnv: "LINEAR_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/linear",
  },
  setup: {
    providerConsoleUrl: "https://linear.app/settings/api",
    steps: [
      "Go to linear.app/settings/api → OAuth applications → Create new",
      "Set Redirect URI to: ${BACKEND_URL}/api/integrations/callback/linear",
      "Set scopes to: read, write",
      "Copy the Client ID and Client Secret",
    ],
    collect: [
      { env: "LINEAR_CLIENT_ID", label: "Linear OAuth Client ID", secret: false },
      { env: "LINEAR_CLIENT_SECRET", label: "Linear OAuth Client Secret", secret: true },
    ],
    docsUrl: "https://developers.linear.app/docs/oauth/authentication",
  },
  tools: createLinearTools,
}

export const linearApiKeyDef: ConnectorDef = {
  id: "linear-api-key",
  name: "Linear (API Key)",
  category: "engineering",
  icon: "linear",
  description: "Connect to Linear using a personal API key instead of OAuth.",
  readOnlyByDefault: false,
  auth: {
    kind: "api_key",
    fields: [
      {
        name: "apiKey",
        label: "Linear API Key",
        placeholder: "lin_api_...",
        secret: true,
      },
    ],
    verify: async (fields) => {
      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: fields.apiKey ?? "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ viewer { id } }" }),
      })
      if (!res.ok) return false
      const data = (await res.json()) as { data?: { viewer?: { id: string } } }
      return Boolean(data.data?.viewer?.id)
    },
  },
  setup: {
    providerConsoleUrl: "https://linear.app/settings/api",
    steps: [
      "Go to linear.app/settings/api → Personal API Keys",
      "Create a new key and copy it",
    ],
    collect: [{ env: "LINEAR_API_KEY", label: "Linear Personal API Key", secret: true }],
    docsUrl: "https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
  },
  tools: createLinearApiKeyTools,
}
