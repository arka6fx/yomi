import { beforeEach, describe, expect, it, mock } from "bun:test"

type SqlCall = { text: string; values: unknown[] }

let sqlCalls: SqlCall[] = []
let executeRows: unknown[] = []
let executeFails = false

mock.module("drizzle-orm", () => ({
  eq: (col: { name: string }, value: unknown) => ({ op: "eq", col, value }),
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
  memoryEntries: { id: { name: "id" } },
  memoryRelations: { __name: "memory_relations" },
}))

const { findDuplicatePairs } = await import("./consolidation.js")

function pairRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    userId: "u1",
    aId: "m1",
    aCreatedAt: new Date("2026-07-01T00:00:00Z"),
    bId: "m2",
    bCreatedAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  }
}

beforeEach(() => {
  sqlCalls = []
  executeRows = []
  executeFails = false
  delete process.env["MEMORY_CONSOLIDATION_MAX_DISTANCE"]
})

describe("findDuplicatePairs", () => {
  it("returns pairs from the query", async () => {
    executeRows = [pairRow()]

    const pairs = await findDuplicatePairs(25)

    expect(pairs).toEqual([
      {
        userId: "u1",
        aId: "m1",
        aCreatedAt: new Date("2026-07-01T00:00:00Z"),
        bId: "m2",
        bCreatedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ])
  })

  it("restricts to active, latest, same-kind rows on both sides", async () => {
    await findDuplicatePairs(25)

    const query = sqlCalls.at(-1)!
    expect(query.text).toContain("a.status = 'active'")
    expect(query.text).toContain("b.status = 'active'")
    expect(query.text).toContain("a.is_latest = true")
    expect(query.text).toContain("b.is_latest = true")
    expect(query.text).toContain("b.kind = a.kind")
  })

  it("passes the configured max distance and batch size as query values", async () => {
    process.env["MEMORY_CONSOLIDATION_MAX_DISTANCE"] = "0.1"

    await findDuplicatePairs(10)

    const query = sqlCalls.at(-1)!
    expect(query.values).toContain(0.1)
    expect(query.values).toContain(10)
  })

  it("defaults to a distance of 0.03 when unset", async () => {
    await findDuplicatePairs(25)

    expect(sqlCalls.at(-1)!.values).toContain(0.03)
  })

  it("ignores a non-numeric or non-positive override and falls back to the default", async () => {
    process.env["MEMORY_CONSOLIDATION_MAX_DISTANCE"] = "not-a-number"

    await findDuplicatePairs(25)

    expect(sqlCalls.at(-1)!.values).toContain(0.03)
  })

  it("returns no pairs when the query fails, rather than throwing", async () => {
    executeFails = true

    expect(await findDuplicatePairs(25)).toEqual([])
  })

  it("drops a row missing an expected id field instead of throwing", async () => {
    executeRows = [pairRow(), { userId: "u1", aId: null, aCreatedAt: new Date(), bId: "m4", bCreatedAt: new Date() }]

    const pairs = await findDuplicatePairs(25)

    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.aId).toBe("m1")
  })
})
