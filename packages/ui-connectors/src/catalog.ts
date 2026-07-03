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
    description: "Read, search, summarize, and send email with approval.",
    category: "email",
    authKind: "oauth2",
    icon: "mail",
    available: true,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Read events and schedule meetings with approval.",
    category: "productivity",
    authKind: "oauth2",
    icon: "calendar",
    available: true,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Search, read, create, edit, and delete your Drive files.",
    category: "productivity",
    authKind: "oauth2",
    icon: "cloud",
    available: true,
  },
  {
    id: "google-classroom",
    name: "Google Classroom",
    description: "Read your classes, assignments, due dates, announcements, and grades.",
    category: "productivity",
    authKind: "oauth2",
    icon: "graduation-cap",
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
    id: "github",
    name: "GitHub",
    description: "Search repositories, issues, pull requests, and code.",
    category: "developer",
    authKind: "oauth2",
    icon: "github",
    available: true,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Search channels and send messages with approval.",
    category: "communication",
    authKind: "oauth2",
    icon: "message-square",
    available: true,
  },
  {
    id: "linear",
    name: "Linear",
    description: "Search issues, create tasks, and manage project work.",
    category: "productivity",
    authKind: "oauth2",
    icon: "list-checks",
    available: true,
  },
  {
    id: "linear-api-key",
    name: "Linear API Key",
    description: "Connect Linear with a personal API key.",
    category: "productivity",
    authKind: "api_key",
    icon: "key-round",
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
