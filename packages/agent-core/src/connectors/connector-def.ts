import type { ToolSet } from "ai"

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

export interface DeveloperSetup {
  providerConsoleUrl: string
  steps: string[]
  collect: { env: string; label: string; secret: boolean }[]
  docsUrl?: string
}

export interface ConnectorContext {
  userId: string
  getAccessToken: (userId: string, provider: string) => Promise<string>
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
  run: () => Promise<T>,
): Promise<T | { id: string; status: string; message: string }> {
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
  // these so the agent never advertises a tool it can't execute. The desktop
  // sidecar runs in Node and keeps them.
  requiresNodeRuntime?: boolean
}
