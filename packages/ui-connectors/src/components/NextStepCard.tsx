"use client"

import type { ConnectorCategory, ConnectorTheme } from "../types"

export interface NextStepSuggestion {
  id: string
  name: string
  category: ConnectorCategory
  reason: string
}

// Ordered by what unlocks the most value first. Deliberately short — this
// is a "get the essentials connected" nudge, not a completion tracker, so
// it disappears once these are done even if dozens of niche connectors
// remain unconnected. Categories checked against catalog.ts (ui-connectors'
// own ConnectorCategory, not agent-core's differently-shaped type).
const NEXT_STEP_PRIORITY: NextStepSuggestion[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "productivity",
    reason: "Yomi can already read your email — add your calendar so it can schedule things too.",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "productivity",
    reason: "Let Yomi search, create, and edit your files, not just email.",
  },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    reason: "Read and send Slack messages from Telegram.",
  },
  {
    id: "notion",
    name: "Notion",
    category: "productivity",
    reason: "Search and update your Notion workspace.",
  },
  {
    id: "github",
    name: "GitHub",
    category: "developer",
    reason: "Check PRs, issues, and repos without leaving the chat.",
  },
  {
    id: "google-tasks",
    name: "Google Tasks",
    category: "productivity",
    reason: "Add and check off tasks by just asking.",
  },
  {
    id: "linear",
    name: "Linear",
    category: "productivity",
    reason: "Track and update Linear issues from Telegram.",
  },
]

export function pickNextStep(connectedIds: string[]): NextStepSuggestion | null {
  const connected = new Set(connectedIds)
  return NEXT_STEP_PRIORITY.find((s) => !connected.has(s.id)) ?? null
}
