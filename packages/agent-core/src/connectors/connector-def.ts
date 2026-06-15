import type { ToolSet } from "ai"

// Returns a structured error for connector tool execute handlers.
// Adds a reconnect hint when the underlying API returned 401 or 403.
export function connectorError(err: unknown): { error: string; hint?: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const appUrl = (typeof process !== "undefined" && process.env["YOMI_APP_URL"]) || "https://yomi.arka6fx.com"
  const isAuth = /(?:→|HTTP)\s*(401|403)\b/.test(msg)
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
}
