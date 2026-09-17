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

// Statements are descriptors, not side effects: db.batch executes them, so the
// recorded writes only happen once the (single) transaction actually runs.
const writer = {
  insert: (table: { __name: string }) => ({
    values: (values: Record<string, unknown>) => ({
      __kind: "insert" as const,
      table,
      values,
      returning: () => ({ __kind: "insert-returning" as const, table, values }),
    }),
  }),
  update: () => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: Condition) => ({ __kind: "update" as const, set, where }),
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
  // neon-http has no interactive transaction. upsertMemory builds every statement up
  // front and hands them to db.batch, which runs them sequentially in one transaction.
  // The mock executes the descriptors in order and rolls back the recorded writes on
  // throw, so a test can tell "the call failed" from "the call failed and left a
  // half-written supersession behind".
  batch: async (statements: unknown[]): Promise<unknown[]> => {
    const snapshot = {
      entryInserts: [...entryInserts],
      relationInserts: [...relationInserts],
      updates: [...updates],
      writeLog: [...writeLog],
    }
    try {
      const results: unknown[] = []
      for (const raw of statements) {
        const statement = raw as {
          __kind?: string
          table?: { __name: string }
          values?: Record<string, unknown>
          set?: Record<string, unknown>
          where?: Condition
        }
        if (statement.__kind === "update") {
          writeLog.push("update:entry")
          updates.push({ set: statement.set!, where: statement.where! })
          results.push([])
        } else if (statement.__kind === "insert" || statement.__kind === "insert-returning") {
          const table = statement.table!.__name
          const values = statement.values!
          if (table === "memory_relations") {
            if (relationInsertFails) throw new Error("relation insert failed")
            writeLog.push("insert:relation")
            relationInserts.push(values as unknown as RelationInsert)
            results.push(undefined)
          } else if (table === "memory_entries") {
            writeLog.push("insert:entry")
            entryInserts.push(values)
            results.push(
              statement.__kind === "insert-returning"
                ? [{ ...values, id: (values["id"] as string | undefined) ?? `saved_${nextId++}` }]
                : undefined,
            )
          } else {
            results.push(undefined)
          }
        } else {
          results.push(await raw)
        }
      }
      return results
    } catch (error) {
      entryInserts = snapshot.entryInserts
      relationInserts = snapshot.relationInserts
      updates = snapshot.updates
      writeLog = snapshot.writeLog
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
  sql: Object.assign(() => ({ op: "sql" }), {
    raw: (value: string) => ({ op: "raw", value }),
    join: (parts: unknown[], separator: unknown) => ({ op: "join", parts, separator }),
  }),
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

// What the extraction model named after being shown candidates (issue #90).
const NAMED_ID = "11111111-1111-4111-8111-111111111111"

describe("upsertMemory replacesId", () => {
  it("supersedes the memory the caller named by id", async () => {
    // Topics differ, so only the named id can produce this supersession.
    rowQueue = [[candidate({ id: NAMED_ID, topic: "editor", version: 2, rootMemoryId: "m0" })], []]
    const saved = await upsertMemory("u1", {
      topic: "tooling",
      content: "uses vs code",
      replacesId: NAMED_ID,
    })
    expect(relationInserts).toEqual([
      { userId: "u1", fromMemoryId: saved!.id, toMemoryId: NAMED_ID, relationType: "updates" },
    ])
    expect(updates[0]!.set).toMatchObject({ status: "superseded", isLatest: false })
    expect(entryInserts[0]).toMatchObject({
      parentMemoryId: NAMED_ID,
      rootMemoryId: "m0",
      version: 3,
    })
  })

  it("looks the named memory up as the caller's own active memory", async () => {
    rowQueue = [[], []]
    await upsertMemory("u1", { topic: "editor", content: "uses vs code", replacesId: NAMED_ID })
    expect(valuesFor(selects[0]?.where, "id")).toEqual([NAMED_ID])
    expect(valuesFor(selects[0]?.where, "user_id")).toEqual(["u1"])
    expect(valuesFor(selects[0]?.where, "status")).toEqual(["active"])
    expect(valuesFor(selects[0]?.where, "is_latest")).toEqual([true])
  })

  // Retrieval or extraction going wrong must cost the supersession, never the memory.
  it("stores the memory anyway when the named id matches nothing", async () => {
    rowQueue = [[], []]
    const saved = await upsertMemory("u1", {
      topic: "tooling",
      content: "uses vs code",
      replacesId: NAMED_ID,
    })
    expect(saved).not.toBeNull()
    expect(relationInserts).toEqual([])
    expect(updates).toEqual([])
    expect(entryInserts[0]).toMatchObject({ parentMemoryId: null, version: 1 })
  })

  // memory_entries.id is a uuid column, so querying a non-uuid raises 22P02 — which would take
  // the whole write down instead of just the supersession.
  it("never queries for an id that is not a memory id", async () => {
    rowQueue = [[]]
    const saved = await upsertMemory("u1", {
      topic: "tooling",
      content: "uses vs code",
      replacesId: "not-a-uuid",
    })
    expect(saved).not.toBeNull()
    expect(selects.flatMap((s) => valuesFor(s.where, "id"))).toEqual([])
  })

  it("supersedes a named memory once even when it also matches by topic", async () => {
    rowQueue = [
      [candidate({ id: NAMED_ID, topic: "editor" })],
      [candidate({ id: NAMED_ID, topic: "editor" })],
    ]
    await upsertMemory("u1", { topic: "editor", content: "uses vs code", replacesId: NAMED_ID })
    expect(relationInserts.map((r) => r.toMemoryId)).toEqual([NAMED_ID])
    expect(updates).toHaveLength(1)
  })
})

describe("upsertMemory model-judged writes", () => {
  // The model saw the candidates and named nothing, so this turn is a duplicate or an
  // elaboration — letting topic equality supersede anyway is the false positive the judgment
  // exists to prevent (ADR 0006).
  it("leaves same-topic memories alone when the model judged the turn", async () => {
    rowQueue = [[candidate({ id: "c1", topic: "editor" })]]
    const saved = await upsertMemory("u1", {
      topic: "editor",
      content: "uses vim with a custom leader key",
      modelJudged: true,
    })
    expect(saved).not.toBeNull()
    expect(selects).toEqual([])
    expect(relationInserts).toEqual([])
    expect(updates).toEqual([])
  })

  // Retrieval failing leaves the model with nothing to judge, so the conservative topic rule
  // stays in charge rather than nothing at all.
  it("still supersedes by topic when the write was not model-judged", async () => {
    rowQueue = [[candidate({ id: "c1", topic: "editor" })]]
    await upsertMemory("u1", { topic: "editor", content: "uses vs code" })
    expect(relationInserts.map((r) => r.toMemoryId)).toEqual(["c1"])
  })
})

describe("POST /add", () => {
  // Supersession by id is a judgment a model makes about candidates it was shown; a request
  // body carries no such judgment (ADR 0006).
  it("ignores a replacesId supplied by an API caller", async () => {
    rowQueue = [[]]
    const res = await memoryRouter.request("/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "editor", content: "uses vs code", replacesId: NAMED_ID }),
    })
    expect(res.status).toBe(200)
    expect(selects.flatMap((s) => valuesFor(s.where, "id"))).toEqual([])
    expect(relationInserts).toEqual([])
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
