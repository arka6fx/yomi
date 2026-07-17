import { describe, expect, it } from "bun:test"
import { generatedSuggestions, suggestionDecisions } from "@yomi/db"

describe("suggestion_decisions schema", () => {
  it("exports the table with dedupKey and decision", () => {
    const t = suggestionDecisions as Record<string, unknown>
    expect(t.dedupKey).toBeDefined()
    expect(t.decision).toBeDefined()
    expect(t.scheduleId).toBeDefined()
  })
})

describe("generated_suggestions schema", () => {
  it("exports the table with the fields needed to reconstruct a SuggestionEntry", () => {
    const t = generatedSuggestions as Record<string, unknown>
    // identity + offerable content
    expect(t.userId).toBeDefined()
    expect(t.dedupKey).toBeDefined()
    expect(t.title).toBeDefined()
    expect(t.description).toBeDefined()
    // schedule spec
    expect(t.schedule).toBeDefined()
    expect(t.prompt).toBeDefined()
    expect(t.deliverTo).toBeDefined()
    // source-pattern metadata for ranking
    expect(t.connector).toBeDefined()
    expect(t.timeBucket).toBeDefined()
    expect(t.distinctDays).toBeDefined()
    // TTL anchor
    expect(t.generatedAt).toBeDefined()
  })
})
