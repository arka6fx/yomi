import { eq } from "drizzle-orm"
import { db, mcpConnections, platformConnections, suggestionDecisions } from "@yomi/db"
import { readGeneratedCache, findGeneratedEntry } from "./cache.js"

export interface SuggestionEntry {
  dedupKey: string
  provider: string | null // mcp_connections provider required; null = offered to everyone
  title: string
  description: string
  requires?: { telegram?: boolean }
  spec: { schedule: string; prompt: string; deliverTo: string[] }
}

// dedupKey is versioned: bump the -vN suffix to deliberately re-offer a
// materially reworded suggestion; dismissals latch per key.
export const SUGGESTION_CATALOG: SuggestionEntry[] = [
  {
    dedupKey: "gmail-daily-briefing-v1",
    provider: "google",
    title: "Daily inbox briefing",
    description: "Every morning at 9am, a summary of unread email: sender, subject, one-line gist.",
    requires: { telegram: true },
    spec: {
      schedule: "every day 9am",
      prompt:
        "Summarize my unread emails from the last 24 hours: sender, subject, and a one-line gist, most important first. If the inbox is clear, say so briefly.",
      deliverTo: ["telegram"],
    },
  },
  {
    dedupKey: "calendar-morning-agenda-v1",
    provider: "google-calendar",
    title: "Morning agenda",
    description: "Every day at 8am, today's events with times, locations, and Meet links.",
    requires: { telegram: true },
    spec: {
      schedule: "every day 8am",
      prompt:
        "Give me today's calendar agenda: each event with time, title, and location or Meet link. Flag conflicts or back-to-back meetings.",
      deliverTo: ["telegram"],
    },
  },
  {
    dedupKey: "drive-weekly-new-files-v1",
    provider: "google-drive",
    title: "Weekly Drive digest",
    description: "Monday mornings, what changed in your Drive this past week, with links.",
    requires: { telegram: true },
    spec: {
      schedule: "every monday 9am",
      prompt:
        "List files added or modified in my Google Drive over the past 7 days, grouped sensibly, each with its link. Keep it short.",
      deliverTo: ["telegram"],
    },
  },
  {
    dedupKey: "github-daily-notifications-v1",
    provider: "github",
    title: "GitHub notifications digest",
    description:
      "Every evening at 6pm, unread notifications grouped by repo; review requests first.",
    requires: { telegram: true },
    spec: {
      schedule: "every day 6pm",
      prompt:
        "Summarize my unread GitHub notifications grouped by repository. Call out review requests and direct mentions first.",
      deliverTo: ["telegram"],
    },
  },
  {
    dedupKey: "daily-checkin-v1",
    provider: null,
    title: "Daily check-in",
    description: "A 5pm nudge: how did today go, anything to schedule or remember?",
    requires: { telegram: true },
    spec: {
      schedule: "every day 5pm",
      prompt:
        "Check in with me: ask how my day went and whether there's anything to schedule, follow up on, or remember for tomorrow.",
      deliverTo: ["telegram"],
    },
  },
]

// Resolve a dedupKey to its entry. Catalog keys resolve from the static catalog;
// generated (gen:*) keys resolve from the user's cache, so accept/dismiss treat
// both identically. userId is required to look up per-user generated entries.
export async function findEntry(
  userId: string,
  dedupKey: string,
): Promise<SuggestionEntry | undefined> {
  const catalogHit = SUGGESTION_CATALOG.find((e) => e.dedupKey === dedupKey)
  if (catalogHit) return catalogHit
  if (!dedupKey.startsWith("gen:")) return undefined
  return findGeneratedEntry(userId, dedupKey)
}

// cache is optional so the GET route can pass a cache it already read (for the SWR
// staleness check) instead of forcing a second identical query.
export async function offerableFor(
  userId: string,
  cache?: { entries: SuggestionEntry[] },
): Promise<SuggestionEntry[]> {
  const [connRows, platformRows, decidedRows, cached] = await Promise.all([
    db
      .select({ provider: mcpConnections.provider })
      .from(mcpConnections)
      .where(eq(mcpConnections.userId, userId)),
    db
      .select({ platform: platformConnections.platform })
      .from(platformConnections)
      .where(eq(platformConnections.userId, userId)),
    db
      .select({ dedupKey: suggestionDecisions.dedupKey })
      .from(suggestionDecisions)
      .where(eq(suggestionDecisions.userId, userId)),
    cache ?? readGeneratedCache(userId),
  ])
  const providers = new Set(connRows.map((r) => r.provider))
  const hasTelegram = platformRows.some((r) => r.platform === "telegram")
  const decided = new Set(decidedRows.map((r) => r.dedupKey))

  // Generated and catalog entries pass the SAME gating (decided latch, connector
  // linked, telegram requirement); generated are simply placed first.
  const gate = (entry: SuggestionEntry): boolean => {
    if (decided.has(entry.dedupKey)) return false
    if (entry.provider && !providers.has(entry.provider)) return false
    if (entry.requires?.telegram && !hasTelegram) return false
    return true
  }

  return [...cached.entries.filter(gate), ...SUGGESTION_CATALOG.filter(gate)]
}
