export type ConnectorCategory =
  | "productivity"
  | "file-storage"
  | "file-management"
  | "email"
  | "data-analytics"
  | "crm"
  | "communication"
  | "developer"
  | "data"
  | "meetings"
  | "food"
  | "finance"
  | "customer-support"
  | "other"

export interface ConnectorInfo {
  id: string
  name: string
  description: string
  category: ConnectorCategory
  authKind: "oauth2" | "composio" | "api_key" | "connection_string"
  icon: string
  /** True if this connector is fully wired (has env vars + backend handler). False = coming soon. */
  available: boolean
  /** Set when the user has connected this connector */
  connected?: boolean
  displayName?: string
  lastSyncAt?: string | null
}
