import { describe, expect, it } from "bun:test"
// Registers all backend ConnectorDefs (mirrors src/index.ts's startup import) — needed
// here because buildNudgeMessage looks up display names via getConnectorDef, and this
// file runs in isolation without the server bootstrap that normally does this import.
import "../connectors/defs/index.js"
import { buildNudgeMessage, computeNextNudgeState } from "./connector-nudge.js"

describe("computeNextNudgeState", () => {
  const now = new Date("2026-08-09T12:00:00.000Z")

  it("creates a new pending state 5 minutes out when none exists", () => {
    const next = computeNextNudgeState(null, "notion", now)
    expect(next.connectorIds).toEqual(["notion"])
    expect(next.dueAt).toBe(new Date("2026-08-09T12:05:00.000Z").toISOString())
  })

  it("appends to an existing batch without moving dueAt", () => {
    const existing = {
      connectorIds: ["notion"],
      dueAt: new Date("2026-08-09T12:03:00.000Z").toISOString(),
    }
    const next = computeNextNudgeState(existing, "slack", now)
    expect(next.connectorIds).toEqual(["notion", "slack"])
    expect(next.dueAt).toBe(existing.dueAt)
  })

  it("dedupes if the same connector connects twice in one window", () => {
    const existing = {
      connectorIds: ["notion"],
      dueAt: new Date("2026-08-09T12:03:00.000Z").toISOString(),
    }
    const next = computeNextNudgeState(existing, "notion", now)
    expect(next.connectorIds).toEqual(["notion"])
  })
})

describe("buildNudgeMessage", () => {
  it("returns null for an empty batch", () => {
    expect(buildNudgeMessage([])).toBeNull()
  })

  it("returns null for a connector with no authored prompts", () => {
    expect(buildNudgeMessage(["not-a-real-connector-id"])).toBeNull()
  })

  it("shows up to 2 prompts for a single connector", () => {
    const msg = buildNudgeMessage(["notion"])
    expect(msg).toContain("Notion")
    expect(msg).toContain("Summarize this week's meeting notes")
    expect(msg).toContain("Tell me when the roadmap page changes")
  })

  it("shows 1 prompt per connector, capped at 3, for a multi-connector batch", () => {
    const msg = buildNudgeMessage(["notion", "slack", "github", "linear"])
    expect(msg).toContain("Summarize this week's meeting notes") // notion's first prompt
    expect(msg).toContain("Summarize unread messages in #general") // slack's first prompt
    expect(msg).toContain("Summarize open issues labeled bug") // github's first prompt
    expect(msg).not.toContain("Summarize what's in progress on my team") // linear's — 4th connector, cut by the cap
  })
})
