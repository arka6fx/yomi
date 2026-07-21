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

export function NextStepCard({
  connectedIds,
  theme: t,
  appUrl,
}: {
  connectedIds: string[]
  theme: ConnectorTheme
  appUrl: string
}) {
  const suggestion = pickNextStep(connectedIds)
  if (!suggestion) return null

  return (
    <div
      style={{
        background: `${t.accent}1f`,
        border: `1px solid ${t.accent}59`,
        borderRadius: 14,
        padding: 16,
        marginBottom: 18,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          fontWeight: 700,
          color: t.accent,
          textTransform: "uppercase" as const,
          marginBottom: 4,
          fontFamily: t.font,
        }}
      >
        Next step
      </div>
      <div
        style={{
          color: t.text,
          fontSize: 15,
          fontWeight: 600,
          marginBottom: 4,
          fontFamily: t.font,
        }}
      >
        Connect {suggestion.name}
      </div>
      <p
        style={{
          color: t.dim,
          fontSize: 12,
          margin: "0 0 10px 0",
          fontFamily: t.font,
        }}
      >
        {suggestion.reason}
      </p>
      <a
        href={`${appUrl}/dashboard?connect=${suggestion.id}`}
        style={{
          display: "inline-block",
          background: t.accent,
          color: t.accentText,
          border: "none",
          borderRadius: 6,
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: t.font,
          textDecoration: "none",
        }}
      >
        Connect →
      </a>
    </div>
  )
}
