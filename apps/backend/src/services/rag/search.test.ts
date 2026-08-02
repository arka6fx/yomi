import { beforeEach, describe, expect, it, mock } from "bun:test"

type SqlCall = { text: string; values: unknown[] }

let sqlCalls: SqlCall[] = []
let executeRows: unknown[] = []
let executeFails = false

mock.module("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { text: strings.join("?"), values }
    sqlCalls.push(call)
    return call
  },
}))

mock.module("@yomi/db", () => ({
  db: {
    execute: async () => {
      if (executeFails) throw new Error("query failed")
      return executeRows
    },
  },
  ragSources: { __name: "rag_sources" },
}))

const { searchRagDocuments } = await import("./search.js")

function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { sourceName: "Notes", title: "Notes", content: "some content", ...over }
}

beforeEach(() => {
  sqlCalls = []
  executeRows = []
  executeFails = false
})

describe("searchRagDocuments", () => {
  it("returns rows from the query", async () => {
    executeRows = [row({ sourceName: "Docs", title: "API", content: "hello" })]

    const rows = await searchRagDocuments("u1", "hello", 5)

    expect(rows).toEqual([{ sourceName: "Docs", title: "API", content: "hello" }])
  })

  it("restricts to the caller's ready/active/backfilling chunks", async () => {
    await searchRagDocuments("u1", "hello", 5)

    const query = sqlCalls.at(-1)!
    expect(query.values).toContain("u1")
    expect(query.text).toContain("status in")
  })

  it("passes the limit through to the query", async () => {
    await searchRagDocuments("u1", "hello", 8)

    expect(sqlCalls.at(-1)!.values).toContain(8)
  })

  it("returns no rows for an empty query", async () => {
    expect(await searchRagDocuments("u1", "   ", 5)).toEqual([])
    expect(sqlCalls).toEqual([])
  })

  it("returns no rows when the query fails, rather than throwing", async () => {
    executeFails = true

    expect(await searchRagDocuments("u1", "hello", 5)).toEqual([])
  })
})
