# Memory Consolidation Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a periodic cron sweep that merges near-duplicate active memories using pure embedding similarity, with zero background LLM cost.

**Architecture:** One new service file (`consolidation.ts`) with three functions — a raw-SQL pgvector self-join that finds duplicate pairs, a survivor-picking/transaction-writing merge action, and a batch orchestrator — wired into the existing `runCronSweeps()` alongside the other five sweeps.

**Tech Stack:** Bun, Drizzle ORM (raw `sql` template for the pgvector join, query builder for the merge transaction), Postgres/pgvector, `bun:test` with `mock.module`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-memory-consolidation-sweep-design.md` — this plan implements it exactly; do not deviate without re-checking that file.
- No LLM calls anywhere in this feature (design's core cost decision).
- `MEMORY_CONSOLIDATION_MAX_DISTANCE` env var, default `0.03`.
- Retired row: `status = 'merged'` (never `'superseded'`), `isLatest = false`. No `version`/`parentMemoryId`/`rootMemoryId` change on either row.
- Relation edge: `{ fromMemoryId: survivorId, toMemoryId: retiredId, relationType: "merges" }`.
- Survivor = later `createdAt`; tie breaks on `id` (string comparison, higher wins).
- Every DB-touching function must degrade to a safe empty/zero result on failure rather than throw — matches `fetchTurnCandidates` and every existing cron sweep's `.catch()` pattern.
- Conventional commit messages (`feat:`, `test:`), lowercase, no full stop, max 72 chars, per `AGENTS.md`.
- Test command for a single file, run from repo root: `bun test --isolate apps/backend/src/services/memory/consolidation.test.ts`.

---

## File Structure

- Create: `apps/backend/src/services/memory/consolidation.ts` — all three functions (`findDuplicatePairs`, `pickSurvivor` + `mergePair`, `sweepMemoryConsolidation`), built up across Tasks 1–3.
- Create: `apps/backend/src/services/memory/consolidation.test.ts` — tests for all three, built up across Tasks 1–3.
- Modify: `apps/backend/src/index.ts` (`runCronSweeps()`, currently lines 152–188) — add the sixth sweep, Task 4.

---

### Task 1: Detection — `findDuplicatePairs`

**Files:**
- Create: `apps/backend/src/services/memory/consolidation.ts`
- Create: `apps/backend/src/services/memory/consolidation.test.ts`

**Interfaces:**
- Consumes: `db` and `sql` from `@yomi/db` / `drizzle-orm`, same shape as `apps/backend/src/services/memory/contradiction.ts`'s `fetchTurnCandidates`.
- Produces:
  ```ts
  export type DuplicatePair = {
    userId: string
    aId: string
    aCreatedAt: Date
    bId: string
    bCreatedAt: Date
  }
  export async function findDuplicatePairs(batchSize: number): Promise<DuplicatePair[]>
  ```
  Task 2 and Task 3 consume this type and function by these exact names.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/services/memory/consolidation.test.ts` with this content:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/services/memory/consolidation.test.ts`
Expected: FAIL — `consolidation.js` does not exist yet (module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/backend/src/services/memory/consolidation.ts` with this content:

```ts
import { eq, sql } from "drizzle-orm"
import { db, memoryEntries, memoryRelations } from "@yomi/db"

// Deliberately much stricter than TURN_CANDIDATE_LIMIT's unbounded shortlist (contradiction.ts)
// — there is no LLM double-check here to catch an elaboration being wrongly merged, so detection
// must be conservative by default. See design:
// docs/superpowers/specs/2026-08-02-memory-consolidation-sweep-design.md
const DEFAULT_MAX_DISTANCE = 0.03

function maxDistance(): number {
  const raw = Number(process.env["MEMORY_CONSOLIDATION_MAX_DISTANCE"])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DISTANCE
}

export type DuplicatePair = {
  userId: string
  aId: string
  aCreatedAt: Date
  bId: string
  bCreatedAt: Date
}

// Self-joins memory_embeddings per user (memory_id > memory_id guards against matching a pair
// twice), requiring both sides active/latest and sharing a kind. Once a row's status flips to
// 'merged' it fails this join, so a merged pair can never be rematched — no tracking column
// needed (design doc, "Self-limiting, no new column").
export async function findDuplicatePairs(batchSize: number): Promise<DuplicatePair[]> {
  const distance = maxDistance()
  try {
    const result = await db.execute(sql`
      select a.user_id as "userId",
             a.id as "aId", a.created_at as "aCreatedAt",
             b.id as "bId", b.created_at as "bCreatedAt"
      from memory_embeddings ea
      join memory_embeddings eb
        on eb.user_id = ea.user_id and eb.memory_id > ea.memory_id
      join memory_entries a on a.id = ea.memory_id
        and a.status = 'active' and a.is_latest = true
      join memory_entries b on b.id = eb.memory_id
        and b.status = 'active' and b.is_latest = true
        and b.kind = a.kind
      where ea.embedding <=> eb.embedding < ${distance}
      order by (ea.embedding <=> eb.embedding) asc
      limit ${batchSize}
    `)
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Record<string, unknown>[]
    return rows
      .filter(
        (row) =>
          typeof row["userId"] === "string" &&
          typeof row["aId"] === "string" &&
          typeof row["bId"] === "string",
      )
      .map((row) => ({
        userId: String(row["userId"]),
        aId: String(row["aId"]),
        aCreatedAt: new Date(row["aCreatedAt"] as string | number | Date),
        bId: String(row["bId"]),
        bCreatedAt: new Date(row["bCreatedAt"] as string | number | Date),
      }))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/memory/consolidation.test.ts`
Expected: PASS — 7 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/memory/consolidation.ts apps/backend/src/services/memory/consolidation.test.ts
git commit -m "feat(memory): detect near-duplicate memories by embedding distance"
```

---

### Task 2: Merge action — `pickSurvivor` + `mergePair`

**Files:**
- Modify: `apps/backend/src/services/memory/consolidation.ts` (append)
- Modify: `apps/backend/src/services/memory/consolidation.test.ts` (append; extend the `@yomi/db` mock)

**Interfaces:**
- Consumes: `DuplicatePair` from Task 1.
- Produces:
  ```ts
  export function pickSurvivor(pair: DuplicatePair): { survivorId: string; retiredId: string }
  export async function mergePair(pair: DuplicatePair): Promise<void>
  ```
  Task 3 consumes `mergePair` by this exact name and signature.

- [ ] **Step 1: Write the failing tests**

Add to the top of `consolidation.test.ts`, replacing the existing `@yomi/db` mock (it needs `transaction` now) — replace the whole `mock.module("@yomi/db", ...)` block with:

```ts
let updates: { set: Record<string, unknown>; where: unknown }[] = []
let relationInserts: Record<string, unknown>[] = []
let transactionShouldFail = false

const writer = {
  update: () => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: unknown) => {
        if (transactionShouldFail) throw new Error("update failed")
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
  memoryEntries: { id: { name: "id" } },
  memoryRelations: { __name: "memory_relations" },
}))
```

And extend the `beforeEach` to also reset the new state:

```ts
beforeEach(() => {
  sqlCalls = []
  executeRows = []
  executeFails = false
  updates = []
  relationInserts = []
  transactionShouldFail = false
  delete process.env["MEMORY_CONSOLIDATION_MAX_DISTANCE"]
})
```

Update the import line to also pull in the two new exports:

```ts
const { findDuplicatePairs, pickSurvivor, mergePair } = await import("./consolidation.js")
```

Then append these new `describe` blocks at the end of the file:

```ts
describe("pickSurvivor", () => {
  it("keeps the row with the later createdAt", () => {
    expect(pickSurvivor(pairRow() as unknown as import("./consolidation.js").DuplicatePair)).toEqual(
      { survivorId: "m2", retiredId: "m1" },
    )
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
  })

  it("writes a merges relation edge from the survivor to the retired row", async () => {
    await mergePair(pairRow() as unknown as import("./consolidation.js").DuplicatePair)

    expect(relationInserts).toEqual([
      { userId: "u1", fromMemoryId: "m2", toMemoryId: "m1", relationType: "merges" },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/services/memory/consolidation.test.ts`
Expected: FAIL — `pickSurvivor` and `mergePair` are not exported yet.

- [ ] **Step 3: Write the minimal implementation**

Append to `consolidation.ts`:

```ts
// The row with the later createdAt survives; ties break on id for determinism.
export function pickSurvivor(pair: DuplicatePair): { survivorId: string; retiredId: string } {
  const aWins =
    pair.aCreatedAt.getTime() > pair.bCreatedAt.getTime() ||
    (pair.aCreatedAt.getTime() === pair.bCreatedAt.getTime() && pair.aId > pair.bId)
  return aWins
    ? { survivorId: pair.aId, retiredId: pair.bId }
    : { survivorId: pair.bId, retiredId: pair.aId }
}

// One transaction: the retired row's status flip and the `merges` relation edge that makes the
// merge inspectable must land together. status='merged', never 'superseded' — CONTEXT.md is
// explicit a duplicate must never supersede. No version/parentMemoryId change on either row: a
// duplicate is not a content evolution of the survivor.
export async function mergePair(pair: DuplicatePair): Promise<void> {
  const { survivorId, retiredId } = pickSurvivor(pair)
  await db.transaction(async (tx) => {
    await tx
      .update(memoryEntries)
      .set({ status: "merged", isLatest: false, updatedAt: new Date() })
      .where(eq(memoryEntries.id, retiredId))
    await tx.insert(memoryRelations).values({
      userId: pair.userId,
      fromMemoryId: survivorId,
      toMemoryId: retiredId,
      relationType: "merges",
    })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/memory/consolidation.test.ts`
Expected: PASS — 11 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/memory/consolidation.ts apps/backend/src/services/memory/consolidation.test.ts
git commit -m "feat(memory): merge a duplicate pair via a merges relation edge"
```

---

### Task 3: Orchestration — `sweepMemoryConsolidation`

**Files:**
- Modify: `apps/backend/src/services/memory/consolidation.ts` (append)
- Modify: `apps/backend/src/services/memory/consolidation.test.ts` (append)

**Interfaces:**
- Consumes: `findDuplicatePairs`, `mergePair` from this file (Tasks 1–2).
- Produces:
  ```ts
  export async function sweepMemoryConsolidation(batchSize?: number): Promise<number>
  ```
  Task 4 consumes this by this exact name, called with no arguments (default `batchSize = 25`).

- [ ] **Step 1: Write the failing tests**

Update the import line in `consolidation.test.ts` once more:

```ts
const { findDuplicatePairs, pickSurvivor, mergePair, sweepMemoryConsolidation } =
  await import("./consolidation.js")
```

Append at the end of the file:

```ts
describe("sweepMemoryConsolidation", () => {
  it("merges every pair the query returns and reports the count", async () => {
    executeRows = [pairRow(), pairRow({ aId: "m3", bId: "m4" })]

    expect(await sweepMemoryConsolidation(25)).toBe(2)
    expect(relationInserts).toHaveLength(2)
  })

  it("continues past a pair that fails to merge, rather than aborting the batch", async () => {
    executeRows = [pairRow(), pairRow({ aId: "m3", bId: "m4" })]
    let calls = 0
    transactionShouldFail = false
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/services/memory/consolidation.test.ts`
Expected: FAIL — `sweepMemoryConsolidation` is not exported yet.

- [ ] **Step 3: Write the minimal implementation**

Append to `consolidation.ts`:

```ts
// Best-effort per pair: one failure (e.g. a row deleted concurrently) doesn't abort the batch —
// matches every other sweep in runCronSweeps (index.ts).
export async function sweepMemoryConsolidation(batchSize = 25): Promise<number> {
  const pairs = await findDuplicatePairs(batchSize)
  let merged = 0
  for (const pair of pairs) {
    try {
      await mergePair(pair)
      merged++
    } catch {
      // best-effort — continue with the remaining pairs
    }
  }
  return merged
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/memory/consolidation.test.ts`
Expected: PASS — 15 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/memory/consolidation.ts apps/backend/src/services/memory/consolidation.test.ts
git commit -m "feat(memory): orchestrate the consolidation sweep batch"
```

---

### Task 4: Wire into the cron sweep

**Files:**
- Modify: `apps/backend/src/index.ts:152-188` (`runCronSweeps`)

**Interfaces:**
- Consumes: `sweepMemoryConsolidation` from `./services/memory/consolidation.js` (Task 3), called with no arguments.
- Produces: nothing new — this is the final integration point.

- [ ] **Step 1: Modify `runCronSweeps`**

In `apps/backend/src/index.ts`, inside `runCronSweeps()`, add the import alongside the other five lazy imports (after the `renewExploreCredits` import line):

```ts
async function runCronSweeps(): Promise<void> {
  const { runDueSchedules } = await import("./services/schedule-runner.js")
  const { runPrivacyRetention } = await import("./services/privacy/retention.js")
  const { runDriveSyncSweep } = await import("./services/rag/drive-sync.js")
  const { summarizeUnsummarizedSessions } = await import("./services/agent-sessions.js")
  const { renewExploreCredits } = await import("./services/explore-renewal.js")
  const { sweepMemoryConsolidation } = await import("./services/memory/consolidation.js")
  await Promise.all([
    runDueSchedules()
      .then(({ ran }) => {
        if (ran > 0) console.warn(`[schedules] ran ${ran} due schedule(s)`)
      })
      .catch((err) => console.error("[schedules] sweep error:", err)),
    runPrivacyRetention()
      .then((r) => {
        const domainTotal = Object.values(r.domains).reduce((sum, n) => sum + n, 0)
        const total =
          r.expiredExports + r.oldDeletionJobs + r.hardDeletedUsers + r.oldAuditEvents + domainTotal
        if (total > 0) console.warn(`[retention] cleaned ${total} items`)
      })
      .catch((err) => console.error("[retention] sweep error:", err)),
    runDriveSyncSweep()
      .then(({ ran }) => {
        if (ran > 0) console.warn(`[drive-sync] swept ${ran} source(s)`)
      })
      .catch((err) => console.error("[drive-sync] sweep error:", err)),
    summarizeUnsummarizedSessions()
      .then((count) => {
        if (count > 0) console.warn(`[session-summary] summarized ${count} session(s)`)
      })
      .catch((err) => console.error("[session-summary] sweep error:", err)),
    renewExploreCredits()
      .then(({ renewed }) => {
        if (renewed > 0) console.warn(`[explore-renewal] renewed ${renewed} account(s)`)
      })
      .catch((err) => console.error("[explore-renewal] sweep error:", err)),
    sweepMemoryConsolidation()
      .then((count) => {
        if (count > 0) console.warn(`[memory-consolidation] merged ${count} pair(s)`)
      })
      .catch((err) => console.error("[memory-consolidation] sweep error:", err)),
  ])
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full backend test suite**

Run: `bun test --isolate apps/backend/src`
Expected: all pass, including the 15 new consolidation tests — confirms the wiring didn't break an existing sweep.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat(memory): run the consolidation sweep every cron tick"
```

---

## Final Verification

- [ ] Run `bun run lint` (AGENTS.md: CI runs lint; it's part of the pre-push checklist).
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate apps/backend/src` from repo root — all pass.
- [ ] Re-read `docs/superpowers/specs/2026-08-02-memory-consolidation-sweep-design.md` and confirm every section (Detection, Merge action, Self-limiting, Wiring, Error handling, Testing) has a corresponding implemented piece.
