import type { ToolSet } from "ai"
import { hasCapability, denialMessage, type CapabilitySet } from "@yomi/shared"

// Returns a structured error for connector tool execute handlers.
// Adds a reconnect hint when the underlying API returned 401 or 403.
export function connectorError(err: unknown): { error: string; hint?: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const appUrl =
    (typeof process !== "undefined" && process.env["YOMI_APP_URL"]) || "https://getyomi.in"
  const isAuth =
    /(?:→|status)\s*(401|403)\b|unauthorized|forbidden|invalid.*token|token.*invalid|revoked/i.test(
      msg,
    )
  const isNotionPermission = /restricted_resource|object_not_found/i.test(msg)
  if (isNotionPermission) {
    return {
      error: msg,
      hint:
        "Notion returned a permission error. Make sure you've shared the relevant pages or databases " +
        "with the Yomi integration (••• → Add connections) inside Notion.",
    }
  }
  return isAuth
    ? { error: msg, hint: `Token expired or revoked — reconnect at ${appUrl}/dashboard` }
    : { error: msg }
}

export type ConnectorCategory =
  | "productivity"
  | "file-storage"
  | "email"
  | "data-analytics"
  | "crm"
  | "support"
  | "finance"
  | "knowledge"
  | "engineering"
  | "design"
  | "security"
  | "hr"
  | "meetings"
  | "communication"
  | "developer"
  | "data"
  | "food"
  | "lifestyle"

export interface ApiKeyField {
  name: string
  label: string
  placeholder?: string
  secret: boolean
}

export type AuthConfig =
  | {
      kind: "oauth2"
      authUrl: string
      tokenUrl: string
      scopes: string[]
      clientIdEnv: string
      clientSecretEnv: string
      redirectPath: string
      pkce?: boolean
      extraAuthParams?: Record<string, string>
      // Notion requires "basic"; most providers use "body"
      tokenRequestAuth?: "body" | "basic"
    }
  | {
      kind: "api_key"
      fields: ApiKeyField[]
      verify?: (creds: Record<string, string>) => Promise<boolean>
    }
  | {
      kind: "connection_string"
      field: { label: string; placeholder: string }
      readOnly: true
    }
  | {
      // Auth is delegated to Composio: it holds the OAuth grant and executes tools.
      // The connect flow opens Composio's connection link instead of a native OAuth
      // redirect, and the connection record stores a connected-account reference
      // (not tokens). `toolkit` is the Composio toolkit slug (e.g. "linear").
      kind: "composio"
      toolkit: string
      // Env var holding the Composio auth-config id used to initiate connections.
      authConfigIdEnv?: string
    }

export interface DeveloperSetup {
  providerConsoleUrl: string
  steps: string[]
  collect: { env: string; label: string; secret: boolean }[]
  docsUrl?: string
}

export interface ConnectorContext {
  userId: string
  getAccessToken: (userId: string, provider: string) => Promise<string>
  // Granted capability set of the caller driving this connector (ADR-0005). When
  // present, connector writes are checked for `connector:execute` before they run
  // or queue. Absent for core/in-process callers, which run at full trust.
  capabilities?: CapabilitySet
  createPendingAction?: (input: {
    connector: string
    action: string
    risk: "write" | "send" | "paid" | "irreversible"
    title: string
    preview: string
    confirmText?: string
    payload: unknown
  }) => Promise<{ id: string; status: string; message: string }>
}

// Wraps a write so it requires user approval when the host supports it.
// When `ctx.createPendingAction` is present the action is queued for confirmation
// (the agent gets an "approval required" message) and `run` is NOT executed.
// When it's absent — e.g. the pending-action executor replaying an approved
// action, or unit tests — `run` executes immediately and performs the real call.
// `action` must be the tool's key so the executor can replay it; `args` becomes
// the stored payload passed back to that same tool on approval.
export async function gateWrite<T>(
  ctx: ConnectorContext,
  meta: {
    connector: string
    action: string
    risk: "write" | "send" | "paid" | "irreversible"
    title: string
    preview: string
    confirmText?: string
  },
  args: unknown,
  run: () => Promise<T> | PromiseLike<T>,
): Promise<T | { id: string; status: string; message: string }> {
  if (ctx.capabilities && !hasCapability(ctx.capabilities, "connector:execute")) {
    return { id: "", status: "denied", message: denialMessage("connector:execute") }
  }
  if (ctx.createPendingAction) {
    return ctx.createPendingAction({ ...meta, payload: args })
  }
  return run()
}

export type ToolFactory = (ctx: ConnectorContext) => ToolSet

export interface ConnectorDef {
  id: string
  name: string
  category: ConnectorCategory
  icon: string
  description: string
  auth: AuthConfig
  setup: DeveloperSetup
  tools: ToolFactory
  readOnlyByDefault: boolean
  // True when the connector's tools can only run in a Node runtime (e.g. raw TCP
  // database drivers like `pg`/`mysql2`). The Cloudflare Workers backend excludes
// these so the agent never advertises a tool it can't execute.
  requiresNodeRuntime?: boolean
  // True when the connector uses MCP (Model Context Protocol) for tool discovery
  // and execution. MCP connectors don't provide static tools via the `tools`
  // factory; instead they connect to one or more MCP servers at runtime and
  // discover tools via `tools/list`.
  isMCPBased?: boolean
  // Async tool loader for MCP-based connectors. Called lazily when the registry
  // connects MCP servers on first use. Takes the standard ConnectorContext plus
  // a userId for auth header resolution. Returns the merged ToolSet from all
  // configured MCP servers. Only present when isMCPBased is true.
  connectMCP?: (
    ctx: ConnectorContext,
  ) => Promise<ToolSet>
}
