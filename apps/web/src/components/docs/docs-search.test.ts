import { describe, expect, it } from "vitest"
import { DOCS_INDEX, matchesQuery } from "./docs-search"

describe("matchesQuery", () => {
  it("matches everything when the query is empty", () => {
    for (const entry of DOCS_INDEX) {
      expect(matchesQuery(entry, "")).toBe(true)
    }
  })

  it("matches a case-insensitive substring of the title", () => {
    const entry = DOCS_INDEX.find((e) => e.id === "connectors")!
    expect(matchesQuery(entry, "CONNECTOR")).toBe(true)
  })

  it("matches a case-insensitive substring of the summary", () => {
    const entry = DOCS_INDEX.find((e) => e.id === "plans")!
    expect(matchesQuery(entry, "SMARTER engine")).toBe(true)
  })

  it("returns false when nothing matches", () => {
    const entry = DOCS_INDEX.find((e) => e.id === "privacy")!
    expect(matchesQuery(entry, "xyzzy-no-match")).toBe(false)
  })

  it("ignores leading/trailing whitespace in the query", () => {
    const entry = DOCS_INDEX.find((e) => e.id === "overview")!
    expect(matchesQuery(entry, "  overview  ")).toBe(true)
  })
})
