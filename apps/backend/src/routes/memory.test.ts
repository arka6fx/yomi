import { beforeEach, describe, expect, it, mock } from "bun:test"

// Relation rules and the edges a save writes (issue #88). The DB is faked the same way
// plugin-registry.test.ts does it, with drizzle helpers reduced to descriptor objects so the
// recorded conditions can be inspected.

type Condition = { op: string; col?: { name: string }; value?: unknown; conditions?: Condition[] }

type CandidateRow = {
  id: string
  kind: string
  scope: string
  topic: string
  summary: string | null
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
  confidence: { name: "confidence" },
  updatedAt: { name: "updated_at" },
}
const memoryRelationsTable = { __name: "memory_relations" }
const memorySourcesTable = { __name: "memory_sources" }
const memoryEmbeddingsTable = { __name: "memory_embeddings" }

let candidateRows: CandidateRow[] = []
let candidateWhere: Condition | null = null
let relationInserts: RelationInsert[] = []
let updates: { set: Record<string, unknown>; where: Condition }[] = []
let nextId = 1

const fakeDb = {
  select: () => ({
    from: () => ({
      where: (where: Condition) => ({
        limit: () => Promise.resolve([]),
        orderBy: () => ({
          limit: () => {
            candidateWhere = where
            return Promise.resolve(candidateRows)
          },
        }),
      }),
    }),
  }),
  insert: (table: { __name: string }) => ({
    values: (values: Record<string, unknown>) => {
      if (table.__name === "memory_relations") {
        relationInserts.push(values as unknown as RelationInsert)
        return Promise.resolve(undefined)
      }
      if (table.__name !== "memory_entries") return Promise.resolve(undefined)
      return {
        returning: () => Promise.resolve([{ ...values, id: `saved_${nextId++}` }]),
      }
    },
  }),
  update: () => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: Condition) => {
        updates.push({ set, where })
        return Promise.resolve([])
      },
    }),
  }),
  delete: () => ({ where: () => Promise.resolve([]) }),
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
  desc: (col: { name: string }) => ({ op: "desc", col }),
  sql: () => ({ op: "sql" }),
}))

mock.module("../auth.js", () => ({
  authenticate: async (_c: unknown, next: () => Promise<void>) => await next(),
}))

mock.module("../middleware/consent.js", () => ({
  requireConsent: () => async (_c: unknown, next: () => Promise<void>) => await next(),
}))

delete process.env["OPENAI_API_KEY"]

const { relationForMemory, upsertMemory } = await import("./memory.js")

function candidate(row: Partial<CandidateRow> & { id: string }): CandidateRow {
  return { kind: "fact", scope: "global", topic: "topic", summary: null, ...row }
}

function conditionsMatching(where: Condition | null, op: string): Condition[] {
  if (!where) return []
  const found = where.op === op ? [where] : []
  for (const child of where.conditions ?? []) found.push(...conditionsMatching(child, op))
  return found
}

function idsIn(where: Condition): unknown[] {
  return conditionsMatching(where, "eq")
    .filter((c) => c.col?.name === "id")
    .map((c) => c.value)
}

beforeEach(() => {
  candidateRows = []
  candidateWhere = null
  relationInserts = []
  updates = []
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
    candidateRows = [
      candidate({ id: "c1", kind: "fact", scope: "global", topic: "dentist appointment" }),
      candidate({ id: "c2", kind: "fact", scope: "global", topic: "sister's birthday" }),
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
    candidateRows = [
      candidate({ id: "c1", topic: "Coffee order" }),
      candidate({ id: "c2", topic: "dentist appointment" }),
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
    expect(idsIn(updates[0]!.where)).toEqual(["c1"])
  })

  it("does not match candidates on kind", async () => {
    await upsertMemory("u1", { kind: "fact", topic: "coffee order", content: "oat flat white" })
    const matched = conditionsMatching(candidateWhere, "ilike").map((c) => c.col?.name)
    expect(matched).toEqual(["topic", "summary"])
  })
})
