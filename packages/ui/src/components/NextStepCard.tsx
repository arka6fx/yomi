"use client"

import { ConnectorIcon } from "../icons"
import type { ConnectorCategory } from "../types"

export interface NextStepSuggestion {
  id: string
  name: string
  category: ConnectorCategory
  reason: string
}

// Ordered by what unlocks the most value first. Deliberately short — this
// is a "get the essentials connected" nudge, not a completion tracker, so
// it disappears once these are done even if dozens of niche connectors
// remain unconnected. Categories checked against catalog.ts (ui package's
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

export function NextStepCard({ connectedIds, appUrl }: { connectedIds: string[]; appUrl: string }) {
  const suggestion = pickNextStep(connectedIds)
  if (!suggestion) return null

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary ring-2 ring-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
          <ConnectorIcon id={suggestion.id} size={17} />
        </div>
        <div className="min-w-0">
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
            Next step
          </p>
          <p className="text-sm font-medium text-foreground">Connect {suggestion.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{suggestion.reason}</p>
        </div>
      </div>
      <a
        href={`${appUrl}/dashboard?connect=${suggestion.id}`}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:self-center"
      >
        Connect
        <span aria-hidden="true">→</span>
      </a>
    </div>
  )
}
