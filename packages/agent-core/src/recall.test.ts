import { describe, expect, it } from "bun:test"
import { createRecallTool, type RecallSearchFn, type SessionRecallResult } from "./recall.js"

function makeResults(count: number): SessionRecallResult[] {
  return Array.from({ length: count }, (_, i) => ({
    sessionId: `session_${i}`,
    title: `Title ${i}`,
    summary: `Summary ${i}`,
    messageCount: 5 + i,
    closedAt: new Date(Date.now() - i * 86400000).toISOString(),
    relevance: 1 - i * 0.1,
  }))
}

describe("createRecallTool", () => {
  it("returns a tool with the correct shape", () => {
    const search: RecallSearchFn = async () => []
    const tool = createRecallTool(search)
    expect(tool).toBeDefined()
    expect(typeof tool.description).toBe("string")
    expect(tool.description).toContain("past conversations")
    expect(tool.parameters).toBeDefined()
  })

  it("calls search with the provided query and default limit", async () => {
    let calledQuery = ""
    let calledLimit = 0
    const search: RecallSearchFn = async (query, limit) => {
      calledQuery = query
      calledLimit = limit
      return makeResults(5)
    }

    const tool = createRecallTool(search)
    const result = await tool.execute!({ query: "pricing discussion" }, {} as never)

    expect(calledQuery).toBe("pricing discussion")
    expect(calledLimit).toBe(5)
    expect(result).toHaveLength(5)
  })

  it("calls search with a custom limit", async () => {
    let calledLimit = 0
    const search: RecallSearchFn = async (_, limit) => {
      calledLimit = limit
      return makeResults(3)
    }

    const tool = createRecallTool(search)
    await tool.execute!({ query: "test", limit: 3 }, {} as never)

    expect(calledLimit).toBe(3)
  })

  it("returns empty array when no results", async () => {
    const search: RecallSearchFn = async () => []
    const tool = createRecallTool(search)
    const result = await tool.execute!({ query: "nothing" }, {} as never)
    expect(result).toEqual([])
  })

  it("passes session results through from search", async () => {
    const fakeResults = makeResults(2)
    const search: RecallSearchFn = async () => fakeResults
    const tool = createRecallTool(search)

    const results = await tool.execute!({ query: "test" }, {} as never)
    expect(results).toEqual(fakeResults)
    expect(results[0]?.sessionId).toBe("session_0")
    expect(results[0]?.title).toBe("Title 0")
  })
})
