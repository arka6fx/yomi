import { describe, expect, it } from "bun:test"
import { ragSources, ragDocuments } from "@yomi/db"

describe("drive-sync schema columns", () => {
  it("ragSources has syncState", () => {
    expect((ragSources as Record<string, unknown>).syncState).toBeDefined()
  })
  it("ragDocuments has externalId", () => {
    expect((ragDocuments as Record<string, unknown>).externalId).toBeDefined()
  })
})
