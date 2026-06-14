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
    id: "google",
    name: "Gmail",
    description: "Read, search, and compose email from your inbox.",
    category: "productivity",
    authKind: "oauth2",
    icon: "mail",
    available: true,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Check your schedule, find free time, and manage events.",
    category: "productivity",
    authKind: "oauth2",
    icon: "calendar",
    available: true,
  },
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
    id: "github",
    name: "GitHub",
    description: "Browse pull requests, issues, and search code.",
    category: "developer",
    authKind: "oauth2",
    icon: "git-branch",
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
  {
    id: "slack",
    name: "Slack",
    description: "Search messages, list channels, and send replies.",
    category: "communication",
    authKind: "oauth2",
    icon: "message-square",
    available: true,
  },
  {
    id: "linear",
    name: "Linear",
    description: "List issues, projects, and manage your sprints.",
    category: "developer",
    authKind: "oauth2",
    icon: "layers",
    available: true,
  },
  {
    id: "linear-api-key",
    name: "Linear (API key)",
    description: "Connect Linear using a personal API key instead of OAuth.",
    category: "developer",
    authKind: "api_key",
    icon: "layers",
    available: true,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Run read-only queries against your own database.",
    category: "data",
    authKind: "connection_string",
    icon: "database",
    available: true,
  },
  {
    id: "mysql",
    name: "MySQL",
    description: "Run read-only queries against your MySQL database.",
    category: "data",
    authKind: "connection_string",
    icon: "database",
    available: true,
  },
  {
    id: "discord-connector",
    name: "Discord",
    description: "View your profile, list servers, and browse channels.",
    category: "communication",
    authKind: "oauth2",
    icon: "message-square",
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
