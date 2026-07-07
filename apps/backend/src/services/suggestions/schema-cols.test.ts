import { describe, expect, it } from "bun:test"
import { suggestionDecisions } from "@yomi/db"

describe("suggestion_decisions schema", () => {
  it("exports the table with dedupKey and decision", () => {
    const t = suggestionDecisions as Record<string, unknown>
    expect(t.dedupKey).toBeDefined()
    expect(t.decision).toBeDefined()
    expect(t.scheduleId).toBeDefined()
  })
})
