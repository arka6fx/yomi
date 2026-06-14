import { ALL_CONNECTOR_DEFS } from "@yomi/agent-core"
import type { ConnectorInfo } from "./types.js"

// Connectors that are fully wired (env vars + backend handler exists)
const AVAILABLE_IDS = new Set([
  "google",
  "google-calendar",
  "google-drive",
  "github",
  "notion",
  "slack",
  "linear",
  "linear-api-key",
  "postgres",
  "mysql",
])

export function buildCatalog(connectedProviders: string[] = []): ConnectorInfo[] {
  const connectedSet = new Set(connectedProviders)
  return ALL_CONNECTOR_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    authKind: def.auth.kind,
    icon: def.icon,
    available: AVAILABLE_IDS.has(def.id),
    connected: connectedSet.has(def.id),
  }))
}
