import type { ConnectorInfo, ConnectorCategory } from "./types.js"

// Static connector catalog — no Node.js dependencies, safe for browser bundles.
// Mirrors ALL_CONNECTOR_DEFS from agent-core but contains only display metadata.
const CATALOG_DEFS: Array<{
  id: string
  name: string
  description: string
  category: ConnectorCategory
  authKind: "oauth2" | "composio" | "api_key" | "connection_string"
  icon: string
  available: boolean
}> = [
  {
    id: "google",
    name: "Gmail",
    description: "Read, search, summarize, and send email with approval.",
    category: "email",
    authKind: "composio",
    icon: "mail",
    available: true,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Read events and schedule meetings with approval.",
    category: "productivity",
    authKind: "composio",
    icon: "calendar",
    available: true,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Search, read, create, edit, and delete your Drive files.",
    category: "productivity",
    authKind: "composio",
    icon: "cloud",
    available: true,
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Create and edit richly formatted Google Docs from Markdown.",
    category: "productivity",
    authKind: "composio",
    icon: "file-text",
    available: true,
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read, create, and edit spreadsheets — rows, formulas, and charts.",
    category: "productivity",
    authKind: "composio",
    icon: "table",
    available: true,
  },
  {
    id: "google-slides",
    name: "Google Slides",
    description: "Build multi-slide presentations from Markdown and edit existing decks.",
    category: "productivity",
    authKind: "composio",
    icon: "presentation",
    available: true,
  },
  {
    id: "google-classroom",
    name: "Google Classroom",
    description: "Read your classes, assignments, due dates, announcements, and grades.",
    category: "productivity",
    authKind: "composio",
    icon: "graduation-cap",
    available: true,
  },
  {
    id: "google-tasks",
    name: "Google Tasks",
    description: "Read your to-do lists and create, edit, or complete tasks with approval.",
    category: "productivity",
    authKind: "composio",
    icon: "list-checks",
    available: true,
  },
  {
    id: "google-meet",
    name: "Google Meet",
    description: "Create meeting links and read past calls, attendees, and transcripts.",
    category: "meetings",
    authKind: "composio",
    icon: "video",
    available: true,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search pages and query databases in your workspace.",
    category: "productivity",
    authKind: "composio",
    icon: "file-text",
    available: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Search repositories, issues, pull requests, and code.",
    category: "developer",
    authKind: "composio",
    icon: "github",
    available: true,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Search channels and send messages with approval.",
    category: "communication",
    authKind: "composio",
    icon: "message-square",
    available: true,
  },
  {
    id: "linear",
    name: "Linear",
    description: "Search issues, create tasks, and manage project work.",
    category: "productivity",
    authKind: "composio",
    icon: "list-checks",
    available: true,
  },
  {
    id: "swiggy",
    name: "Swiggy",
    description: "Order food, groceries, and book restaurant tables via Telegram.",
    category: "food",
    authKind: "oauth2",
    icon: "swiggy",
    available: true,
  },
]

// displayNames maps connector id → the account it is bound to (usually an email).
// Each connector is its own OAuth grant, so they can legitimately sit on different
// Google accounts — showing the account is the only way a user can tell.
export function buildCatalog(
  connectedProviders: string[] = [],
  displayNames: Record<string, string> = {},
): ConnectorInfo[] {
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
    displayName: displayNames[def.id],
  }))
}
