import type { ConnectorInfo, ConnectorCategory } from "./types.js"

// Static connector catalog — no Node.js dependencies, safe for browser bundles.
// Mirrors ALL_CONNECTOR_DEFS from agent-core but contains only display metadata.
const CATALOG_DEFS: Array<{
  id: string
  name: string
  description: string
  category: ConnectorCategory
  authKind: "oauth2" | "api_key" | "connection_string"
  icon: string
  available: boolean
}> = [
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Search, read, and navigate your Drive files.",
    category: "productivity",
    authKind: "oauth2",
    icon: "cloud",
    available: true,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search pages and query databases in your workspace.",
    category: "productivity",
    authKind: "oauth2",
    icon: "file-text",
    available: true,
  },
]

export function buildCatalog(connectedProviders: string[] = []): ConnectorInfo[] {
  const connectedSet = new Set(connectedProviders)
  return CATALOG_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    authKind: def.authKind,
    icon: def.icon,
    available: def.available,
    connected: connectedSet.has(def.id),
  }))
}
