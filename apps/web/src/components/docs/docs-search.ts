export type DocsGroup = "Getting Started" | "Capabilities" | "Account"

export interface DocsEntry {
  id: string
  title: string
  group: DocsGroup
  summary: string
}

// Ids match the `Section` ids in ../../app/docs/page.tsx exactly — this is the
// single source of truth for the sidebar, the "on this page" outline, and search.
export const DOCS_INDEX: DocsEntry[] = [
  {
    id: "overview",
    title: "Overview",
    group: "Getting Started",
    summary: "What Yomi is and how the web app and Telegram bot share memory.",
  },
  {
    id: "getting-started",
    title: "Getting started",
    group: "Getting Started",
    summary: "Sign up, connect your apps, and start chatting.",
  },
  {
    id: "web",
    title: "Web app",
    group: "Getting Started",
    summary: "Image analysis, voice and text, visible actions, two routing paths.",
  },
  {
    id: "telegram",
    title: "Telegram bot",
    group: "Getting Started",
    summary: "Chat commands, voice notes, and image analysis on Telegram.",
  },
  {
    id: "connectors",
    title: "App connectors",
    group: "Capabilities",
    summary: "Gmail, Calendar, Drive, Docs, Sheets, Slides, GitHub, Notion, Slack, Linear.",
  },
  {
    id: "memory",
    title: "Memory & knowledge",
    group: "Capabilities",
    summary: "Long-term memory and your synced documents (RAG).",
  },
  {
    id: "voice-vision",
    title: "Voice & vision",
    group: "Capabilities",
    summary: "Speak and listen, and send a screenshot or photo for analysis.",
  },
  {
    id: "approvals",
    title: "Approvals & safety",
    group: "Capabilities",
    summary: "Actions that send or change things pause for your approval first.",
  },
  {
    id: "plans",
    title: "Plans",
    group: "Account",
    summary: "The free and Pro plans: unlimited chat, routines and the smarter engine.",
  },
  {
    id: "privacy",
    title: "Privacy",
    group: "Account",
    summary: "What happens to connected-app data and how to disconnect.",
  },
]

export function matchesQuery(entry: DocsEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return entry.title.toLowerCase().includes(q) || entry.summary.toLowerCase().includes(q)
}
