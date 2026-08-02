import { beforeEach, describe, expect, it, mock } from "bun:test"

type SqlCall = { text: string; values: unknown[] }

let sqlCalls: SqlCall[] = []
let executeRows: unknown[] = []
let executeFails = false
let updates: { set: Record<string, unknown>; where: unknown }[] = []
let relationInserts: Record<string, unknown>[] = []

mock.module("drizzle-orm", () => ({
  eq: (col: { name: string }, value: unknown) => ({ op: "eq", col, value }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { text: strings.join("?"), values }
    sqlCalls.push(call)
    return call
  },
}))

const writer = {
  update: () => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: unknown) => {
        updates.push({ set, where })
        return Promise.resolve([])
      },
    }),
  }),
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      relationInserts.push(values)
      return Promise.resolve(undefined)
    },
  }),
}

mock.module("@yomi/db", () => ({
  db: {
    execute: async () => {
      if (executeFails) throw new Error("query failed")
      return executeRows
    },
    transaction: async <T>(fn: (tx: typeof writer) => Promise<T>): Promise<T> => fn(writer),
  },
  memoryEntries: { id: { name: "id" }, status: { name: "status" } },
  memoryRelations: { __name: "memory_relations" },
}))

const { findDuplicatePairs, pickSurvivor, mergePair, sweepMemoryConsolidation } =
  await import("./consolidation.js")

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
  updates = []
  relationInserts = []
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
    executeRows = [
      pairRow(),
      { userId: "u1", aId: null, aCreatedAt: new Date(), bId: "m4", bCreatedAt: new Date() },
    ]

    const pairs = await findDuplicatePairs(25)

    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.aId).toBe("m1")
  })
})

describe("pickSurvivor", () => {
  it("keeps the row with the later createdAt", () => {
    expect(
      pickSurvivor(pairRow() as unknown as import("./consolidation.js").DuplicatePair),
    ).toEqual({ survivorId: "m2", retiredId: "m1" })
  })

  it("breaks a tie on id, higher wins", () => {
    const tie = new Date("2026-07-01T00:00:00Z")
    expect(
      pickSurvivor({ userId: "u1", aId: "m1", aCreatedAt: tie, bId: "m2", bCreatedAt: tie }),
    ).toEqual({ survivorId: "m2", retiredId: "m1" })
    expect(
      pickSurvivor({ userId: "u1", aId: "m9", aCreatedAt: tie, bId: "m2", bCreatedAt: tie }),
    ).toEqual({ survivorId: "m9", retiredId: "m2" })
  })
})

describe("mergePair", () => {
  it("retires the older row as status=merged, isLatest=false", async () => {
    await mergePair(pairRow() as unknown as import("./consolidation.js").DuplicatePair)

    expect(updates).toHaveLength(1)
    expect(updates[0]!.set).toMatchObject({ status: "merged", isLatest: false })
    const where = updates[0]!.where as {
      op: string
      conditions: { op: string; col: { name: string }; value: unknown }[]
    }
    expect(where.op).toBe("and")
    const idCondition = where.conditions.find((c) => c.col?.name === "id")
    expect(idCondition?.value).toBe("m1")
  })

  it("writes a merges relation edge from the survivor to the retired row", async () => {
    await mergePair(pairRow() as unknown as import("./consolidation.js").DuplicatePair)

    expect(relationInserts).toEqual([
      { userId: "u1", fromMemoryId: "m2", toMemoryId: "m1", relationType: "merges" },
    ])
  })
})

describe("sweepMemoryConsolidation", () => {
  it("merges every pair the query returns and reports the count", async () => {
    executeRows = [pairRow(), pairRow({ aId: "m3", bId: "m4" })]

    expect(await sweepMemoryConsolidation(25)).toBe(2)
    expect(relationInserts).toHaveLength(2)
  })

  it("continues past a pair that fails to merge, rather than aborting the batch", async () => {
    executeRows = [pairRow(), pairRow({ aId: "m3", bId: "m4" })]
    let calls = 0
    const originalUpdate = writer.update
    writer.update = () => {
      calls++
      if (calls === 1) throw new Error("first pair failed")
      return originalUpdate()
    }

    expect(await sweepMemoryConsolidation(25)).toBe(1)

    writer.update = originalUpdate
  })

  it("returns 0 when the detection query fails", async () => {
    executeFails = true

    expect(await sweepMemoryConsolidation(25)).toBe(0)
  })

  it("defaults batchSize to 25", async () => {
    await sweepMemoryConsolidation()

    expect(sqlCalls.at(-1)!.values).toContain(25)
  })
})
