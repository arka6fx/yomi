import { beforeEach, describe, expect, it, mock } from "bun:test"

// Relation rules, the edges a save writes (issue #88), and the supersession guarantee plus its
// read path (issue #89). The DB is faked the same way plugin-registry.test.ts does it, with
// drizzle helpers reduced to descriptor objects so the recorded conditions can be inspected.
// Every select resolves from `rowQueue` in call order.

type Condition = { op: string; col?: { name: string }; value?: unknown; conditions?: Condition[] }

type CandidateRow = {
  id: string
  kind: string
  scope: string
  topic: string
  summary: string | null
  version: number
  rootMemoryId: string | null
}

type RelationInsert = {
  userId: string
  fromMemoryId: string
  toMemoryId: string
  relationType: string
}

const memoryEntriesTable = {
  __name: "memory_entries",
  id: { name: "id" },
  userId: { name: "user_id" },
  customId: { name: "custom_id" },
  status: { name: "status" },
  isLatest: { name: "is_latest" },
  kind: { name: "kind" },
  scope: { name: "scope" },
  topic: { name: "topic" },
  summary: { name: "summary" },
  content: { name: "content" },
  confidence: { name: "confidence" },
  isStatic: { name: "is_static" },
  updatedAt: { name: "updated_at" },
}
const memoryRelationsTable = {
  __name: "memory_relations",
  userId: { name: "user_id" },
  fromMemoryId: { name: "from_memory_id" },
  toMemoryId: { name: "to_memory_id" },
  relationType: { name: "relation_type" },
}
const memorySourcesTable = { __name: "memory_sources" }
const memoryEmbeddingsTable = { __name: "memory_embeddings" }

let rowQueue: unknown[][] = []
let selects: { table: string; where: Condition }[] = []
let entryInserts: Record<string, unknown>[] = []
let relationInserts: RelationInsert[] = []
let updates: { set: Record<string, unknown>; where: Condition }[] = []
let relationInsertFails = false
let writeLog: string[] = []
let nextId = 1

function nextRows(): Promise<unknown[]> {
  return Promise.resolve(rowQueue.shift() ?? [])
}

const writer = {
  insert: (table: { __name: string }) => ({
    values: (values: Record<string, unknown>) => {
      if (table.__name === "memory_relations") {
        if (relationInsertFails) return Promise.reject(new Error("relation insert failed"))
        writeLog.push("insert:relation")
        relationInserts.push(values as unknown as RelationInsert)
        return Promise.resolve(undefined)
      }
      if (table.__name !== "memory_entries") return Promise.resolve(undefined)
      writeLog.push("insert:entry")
      entryInserts.push(values)
      return { returning: () => Promise.resolve([{ ...values, id: `saved_${nextId++}` }]) }
    },
  }),
  update: () => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: Condition) => {
        writeLog.push("update:entry")
        updates.push({ set, where })
        return Promise.resolve([])
      },
    }),
  }),
}

const fakeDb = {
  ...writer,
  select: () => ({
    from: (table: { __name: string }) => ({
      where: (where: Condition) => {
        selects.push({ table: table.__name, where })
        return {
          limit: () => nextRows(),
          orderBy: () => ({ limit: () => nextRows() }),
          then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
            nextRows().then(resolve, reject),
        }
      },
    }),
  }),
  delete: () => ({ where: () => Promise.resolve([]) }),
  execute: () => Promise.resolve([]),
  // Rolls back the recorded writes on throw, so a test can tell "the call failed" from
  // "the call failed and left a half-written supersession behind".
  transaction: async <T>(fn: (tx: typeof writer) => Promise<T>): Promise<T> => {
    const snapshot = {
      entryInserts: [...entryInserts],
      relationInserts: [...relationInserts],
      updates: [...updates],
    }
    try {
      return await fn(writer)
    } catch (error) {
      entryInserts = snapshot.entryInserts
      relationInserts = snapshot.relationInserts
      updates = snapshot.updates
      throw error
    }
  },
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  memoryEntries: memoryEntriesTable,
  memoryRelations: memoryRelationsTable,
  memorySources: memorySourcesTable,
  memoryEmbeddings: memoryEmbeddingsTable,
}))

mock.module("drizzle-orm", () => ({
  and: (...conditions: Condition[]) => ({ op: "and", conditions: conditions.filter(Boolean) }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions: conditions.filter(Boolean) }),
  eq: (col: { name: string }, value: unknown) => ({ op: "eq", col, value }),
  ilike: (col: { name: string }, value: unknown) => ({ op: "ilike", col, value }),
  inArray: (col: { name: string }, value: unknown) => ({ op: "inArray", col, value }),
  desc: (col: { name: string }) => ({ op: "desc", col }),
  sql: () => ({ op: "sql" }),
}))

mock.module("../auth.js", () => ({
  authenticate: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("user", { id: "u1", email: "user@example.com", role: "user" })
    await next()
  },
}))

mock.module("../middleware/consent.js", () => ({
  requireConsent: () => async (_c: unknown, next: () => Promise<void>) => await next(),
}))

delete process.env["OPENAI_API_KEY"]

const { memoryRouter, relationForMemory, upsertMemory } = await import("./memory.js")

function candidate(row: Partial<CandidateRow> & { id: string }): CandidateRow {
  return {
    kind: "fact",
    scope: "global",
    topic: "topic",
    summary: null,
    version: 1,
    rootMemoryId: null,
    ...row,
  }
}

function conditionsMatching(where: Condition | null | undefined, op: string): Condition[] {
  if (!where) return []
  const found = where.op === op ? [where] : []
  for (const child of where.conditions ?? []) found.push(...conditionsMatching(child, op))
  return found
}

function valuesFor(where: Condition | undefined, name: string): unknown[] {
  return conditionsMatching(where, "eq")
    .filter((c) => c.col?.name === name)
    .map((c) => c.value)
}

beforeEach(() => {
  rowQueue = []
  selects = []
  entryInserts = []
  relationInserts = []
  updates = []
  relationInsertFails = false
  writeLog = []
  nextId = 1
})

describe("relationForMemory", () => {
  it("supersedes a candidate whose topic matches after normalization", () => {
    const relation = relationForMemory(
      { kind: "fact", scope: "global", topic: "Coffee Order", content: "oat flat white" },
      candidate({ id: "c1", topic: "coffee order" }),
    )
    expect(relation).toBe("updates")
  })

  it("supersedes a candidate named by replacesTopic", () => {
    const relation = relationForMemory(
      { topic: "commute", replacesTopic: "office commute", content: "works from home" },
      candidate({ id: "c1", topic: "Office commute route" }),
    )
    expect(relation).toBe("updates")
  })

  it("returns no relation for a candidate sharing only kind and scope", () => {
    const relation = relationForMemory(
      { kind: "fact", scope: "global", topic: "coffee order", content: "oat flat white" },
      candidate({ id: "c1", kind: "fact", scope: "global", topic: "dentist appointment" }),
    )
    expect(relation).toBeNull()
  })
})

describe("upsertMemory relation edges", () => {
  it("writes no edges to candidates that share only kind and scope", async () => {
    rowQueue = [
      [
        candidate({ id: "c1", topic: "dentist appointment" }),
        candidate({ id: "c2", topic: "sister's birthday" }),
      ],
    ]
    await upsertMemory("u1", {
      kind: "fact",
      scope: "global",
      topic: "coffee order",
      content: "oat flat white",
    })
    expect(relationInserts).toEqual([])
    expect(updates).toEqual([])
  })

  it("writes an updates edge and supersedes a candidate on the same topic", async () => {
    rowQueue = [
      [candidate({ id: "c1", topic: "Coffee order" }), candidate({ id: "c2", topic: "dentist" })],
    ]
    const saved = await upsertMemory("u1", {
      kind: "fact",
      scope: "global",
      topic: "coffee order",
      content: "oat flat white",
    })
    expect(relationInserts).toEqual([
      { userId: "u1", fromMemoryId: saved!.id, toMemoryId: "c1", relationType: "updates" },
    ])
    expect(updates).toHaveLength(1)
    expect(updates[0]!.set).toMatchObject({ status: "superseded", isLatest: false })
    expect(valuesFor(updates[0]!.where, "id")).toEqual(["c1"])
  })

  it("does not match candidates on kind", async () => {
    await upsertMemory("u1", { kind: "fact", topic: "coffee order", content: "oat flat white" })
    const matched = conditionsMatching(selects[0]?.where, "ilike").map((c) => c.col?.name)
    expect(matched).toEqual(["topic", "summary"])
  })
})

describe("upsertMemory supersession guarantee", () => {
  it("chains the new memory onto the candidate it supersedes", async () => {
    rowQueue = [[candidate({ id: "c1", topic: "coffee order", version: 3, rootMemoryId: "c0" })]]
    await upsertMemory("u1", { topic: "coffee order", content: "oat flat white" })
    expect(entryInserts[0]).toMatchObject({
      parentMemoryId: "c1",
      rootMemoryId: "c0",
      version: 4,
      isLatest: true,
    })
  })

  it("roots the chain at the superseded memory when it had no root", async () => {
    rowQueue = [[candidate({ id: "c1", topic: "coffee order", version: 1, rootMemoryId: null })]]
    await upsertMemory("u1", { topic: "coffee order", content: "oat flat white" })
    expect(entryInserts[0]).toMatchObject({ parentMemoryId: "c1", rootMemoryId: "c1", version: 2 })
  })

  it("starts a fresh chain when nothing is superseded", async () => {
    await upsertMemory("u1", { topic: "coffee order", content: "oat flat white" })
    expect(entryInserts[0]).toMatchObject({ parentMemoryId: null, rootMemoryId: null, version: 1 })
  })

  it("edges every superseded memory, not just the chain parent", async () => {
    rowQueue = [
      [
        candidate({ id: "c1", topic: "coffee order" }),
        candidate({ id: "c2", topic: "Coffee Order" }),
      ],
    ]
    const saved = await upsertMemory("u1", { topic: "coffee order", content: "oat flat white" })
    expect(relationInserts.map((r) => r.toMemoryId)).toEqual(["c1", "c2"])
    expect(relationInserts.every((r) => r.fromMemoryId === saved!.id)).toBe(true)
    expect(updates.map((u) => valuesFor(u.where, "id")[0])).toEqual(["c1", "c2"])
  })

  // (user_id, custom_id) is uniquely indexed where custom_id is not null, so the new row cannot
  // take the id over until the row it supersedes has let go of it.
  it("frees the custom id before inserting the memory that takes it over", async () => {
    rowQueue = [
      [
        {
          id: "e1",
          customId: "coffee-pref",
          topic: "coffee order",
          version: 1,
          rootMemoryId: null,
        },
      ],
      [],
    ]
    await upsertMemory("u1", { customId: "coffee-pref", topic: "coffee order", content: "oat" })
    expect(writeLog[0]).toBe("update:entry")
    expect(writeLog[1]).toBe("insert:entry")
    expect(updates[0]!.set).toEqual({ customId: null })
    expect(valuesFor(updates[0]!.where, "id")).toEqual(["e1"])
    expect(entryInserts[0]).toMatchObject({ customId: "coffee-pref", parentMemoryId: "e1" })
  })

  it("surfaces a failure to record the link instead of swallowing it", async () => {
    rowQueue = [[candidate({ id: "c1", topic: "coffee order" })]]
    relationInsertFails = true
    await expect(
      upsertMemory("u1", { topic: "coffee order", content: "oat flat white" }),
    ).rejects.toThrow("relation insert failed")
  })

  it("leaves no half-written supersession when the link fails", async () => {
    rowQueue = [[candidate({ id: "c1", topic: "coffee order" })]]
    relationInsertFails = true
    await upsertMemory("u1", { topic: "coffee order", content: "oat flat white" }).catch(
      () => undefined,
    )
    expect(entryInserts).toEqual([])
    expect(updates).toEqual([])
  })
})

describe("GET /superseded", () => {
  it("returns superseded memories with what replaced them", async () => {
    rowQueue = [
      [{ id: "old1", topic: "coffee order", content: "flat white", status: "superseded" }],
      [{ fromMemoryId: "new1", toMemoryId: "old1" }],
      [{ id: "new1", topic: "coffee order", summary: null, content: "oat flat white" }],
    ]
    const res = await memoryRouter.request("/superseded")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      memories: { id: string; replacedBy: { id: string; content: string } | null }[]
    }
    expect(body.memories).toHaveLength(1)
    expect(body.memories[0]!.id).toBe("old1")
    expect(body.memories[0]!.replacedBy).toMatchObject({ id: "new1", content: "oat flat white" })
  })

  it("reads only the owner's superseded memories", async () => {
    rowQueue = [[]]
    await memoryRouter.request("/superseded")
    expect(valuesFor(selects[0]?.where, "user_id")).toEqual(["u1"])
    expect(valuesFor(selects[0]?.where, "status")).toEqual(["superseded"])
  })

  it("leaves the replacement null when no edge records it", async () => {
    rowQueue = [[{ id: "old1", topic: "coffee order", content: "flat white" }], [], []]
    const res = await memoryRouter.request("/superseded")
    const body = (await res.json()) as { memories: { replacedBy: unknown }[] }
    expect(body.memories[0]!.replacedBy).toBeNull()
  })
})

describe("recall", () => {
  it("excludes superseded memories from GET /entries", async () => {
    rowQueue = [[]]
    await memoryRouter.request("/entries")
    expect(valuesFor(selects[0]?.where, "status")).toEqual(["active"])
    expect(valuesFor(selects[0]?.where, "is_latest")).toEqual([true])
  })
})
