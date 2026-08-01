import { describe, expect, it } from "bun:test"
import { ALL_CONNECTOR_DEFS } from "../all-defs.js"
import { COMPOSIO_RISK_MAP, classifyAction } from "./classification.js"

// Guards the failure that shipped for googlephotos: the toolkit had no entry in
// COMPOSIO_RISK_MAP at all, so default-deny classified its six read actions as
// writes and every list/get threw a raw-JSON approval card at the user, despite
// the def declaring readOnlyByDefault. Nothing failed — it just silently gated.
//
// Default-deny keeps that safe (an unclassified action is never auto-run), but it
// makes reads unusable. These tests are a ratchet over the existing debt: a new
// connector wired without classification fails CI, and a baselined toolkit can
// only ever shrink. Fix a toolkit, then lower or delete its line below.

// toolkit → number of wired actions still missing an explicit classification.
// Every one of these is gated as a write today. Drop the entry when it hits 0.
const KNOWN_GAPS: Record<string, number> = {
  // No risk-map block at all — every action defaults to write.
  microsoft_teams: 28,
  neon: 10,
  fireflies: 10,
  google_cloud_vision: 9,
  kaggle: 8,
  google_search_console: 6,
  googleads: 5,
  google_analytics: 4,
  // Block exists, some actions uncovered.
  supabase: 23,
  outlook: 22,
  todoist: 16,
  asana: 12,
  whatsapp: 11,
  instagram: 7,
  jira: 6,
  cloudflare: 6,
  vercel: 6,
  hubspot: 5,
  posthog: 5,
  calendly: 4,
  miro: 3,
  serpapi: 3,
  one_drive: 2,
  firecrawl: 1,
  youtube: 1,
  facebook: 1,
  trello: 1,
  dropbox: 1,
  mem0: 1,
}

const ctx = {
  userId: "test-user",
  getAccessToken: async () => "test-token",
  createPendingAction: async () => "pending-id",
}

type Def = (typeof ALL_CONNECTOR_DEFS)[number]

function composioDefs(): Def[] {
  return ALL_CONNECTOR_DEFS.filter((def) => def.auth.kind === "composio" && !def.isMCPBased)
}

function toolkitOf(def: Def): string {
  return def.auth.kind === "composio" ? def.auth.toolkit.toLowerCase() : ""
}

function unclassifiedFor(def: Def): string[] {
  const block = COMPOSIO_RISK_MAP[toolkitOf(def)] ?? {}
  return Object.keys(def.tools(ctx as never)).filter((slug) => !(slug in block))
}

describe("Composio risk-map coverage", () => {
  it("classifies every wired action except the known baseline", () => {
    const unexpected: string[] = []
    for (const def of composioDefs()) {
      const toolkit = toolkitOf(def)
      const gaps = unclassifiedFor(def)
      const allowed = KNOWN_GAPS[toolkit] ?? 0
      if (gaps.length > allowed) {
        unexpected.push(
          `${toolkit}: ${gaps.length} unclassified, baseline allows ${allowed} — ${gaps.slice(0, 5).join(", ")}`,
        )
      }
    }

    expect(unexpected).toEqual([])
  })

  it("has no stale baseline entries", () => {
    const byToolkit = new Map<string, number>()
    for (const def of composioDefs()) {
      byToolkit.set(toolkitOf(def), unclassifiedFor(def).length)
    }

    const stale = Object.entries(KNOWN_GAPS)
      .filter(([toolkit, allowed]) => (byToolkit.get(toolkit) ?? 0) < allowed)
      .map(
        ([toolkit, allowed]) =>
          `${toolkit}: baseline ${allowed}, actual ${byToolkit.get(toolkit) ?? 0} — lower or remove it`,
      )

    expect(stale).toEqual([])
  })

  it("returns a valid risk for every wired action", () => {
    const risks = ["read", "write", "send", "paid", "irreversible"]
    for (const def of composioDefs()) {
      for (const slug of Object.keys(def.tools(ctx as never))) {
        expect(risks).toContain(classifyAction(toolkitOf(def), slug))
      }
    }
  })

  it("fully classifies the connectors already cleaned up", () => {
    const clean = composioDefs().filter((def) => !(toolkitOf(def) in KNOWN_GAPS))
    expect(clean.length).toBeGreaterThan(0)
    for (const def of clean) {
      expect({ toolkit: toolkitOf(def), unclassified: unclassifiedFor(def) }).toEqual({
        toolkit: toolkitOf(def),
        unclassified: [],
      })
    }
  })
})
