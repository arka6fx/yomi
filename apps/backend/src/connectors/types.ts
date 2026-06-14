import type { ConnectorDef } from "@yomi/agent-core"

// Backend extension of ConnectorDef with optional server-side capabilities.
export interface BackendConnectorDef extends ConnectorDef {
  // Fetch a user-friendly display name after OAuth (e.g. account email or GitHub username).
  // Defaults to def.name if not provided.
  getDisplayName?: (accessToken: string) => Promise<string>
}
