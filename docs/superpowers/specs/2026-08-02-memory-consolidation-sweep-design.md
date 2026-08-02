# Memory consolidation sweep — design

Status: approved
Date: 2026-08-02
Backlog ref: `docs/agentic-backlog.md` item 4b

## Problem

`memory_entries` accumulates near-duplicate active memories — the same claim
reworded across turns ("uses vim" / "is a vim user"). Per the `Duplicate`
definition in `CONTEXT.md`, a duplicate must never supersede (that's reserved
for `Contradiction`), so today duplicates simply pile up, crowding the
injection budget and the candidate set every future turn embeds against.

Item 4b in the agentic backlog was deliberately deferred because a periodic
merge sweep implies background LLM judging calls with no established
per-user cost or fairness story — unmetered spend outside any user-initiated
action. This design resolves that by not using an LLM at all.

## Goal

A periodic sweep that merges near-duplicate **active** memories using pure
embedding similarity — zero background LLM cost, fully deterministic,
reversible via the same relation-edge pattern the memory engine already uses
for supersession.

## Non-goals

- Catching paraphrased duplicates that aren't near-identical in embedding
  space (e.g. "uses vim" / "is a vim user" phrased very differently). That
  needs a judge call and is out of scope here — tracked as a possible future
  iteration if the embedding-only approach proves too conservative.
- Synthesizing a new combined memory from two duplicates. Out of scope;
  revisit only if plain retire-the-older loses information in practice.
- Cross-user or cross-kind merging. A pair must share `userId` and `kind`.

## Detection

New file: `apps/backend/src/services/memory/consolidation.ts`.

```
sweepMemoryConsolidation(batchSize = 25): Promise<number>
```

One SQL query self-joins `memory_embeddings` per `user_id`:

```sql
select a.user_id, a.memory_id as a_id, b.memory_id as b_id, a.created_at as a_created, b.created_at as b_created
from memory_embeddings ea
join memory_embeddings eb
  on eb.user_id = ea.user_id and eb.memory_id > ea.memory_id
join memory_entries a on a.id = ea.memory_id
  and a.status = 'active' and a.is_latest = true
join memory_entries b on b.id = eb.memory_id
  and b.status = 'active' and b.is_latest = true
  and b.kind = a.kind
where ea.embedding <=> eb.embedding < :maxDistance
order by (ea.embedding <=> eb.embedding) asc
limit :batchSize
```

- `memory_id > memory_id` join guard avoids matching a pair twice.
- `maxDistance` is `MEMORY_CONSOLIDATION_MAX_DISTANCE`, default **0.03**
  (~0.97 cosine similarity). Deliberately much stricter than the 20-nearest
  shortlist used for contradiction detection (`TURN_CANDIDATE_LIMIT`,
  distance-unbounded) — there is no LLM double-check here to catch an
  elaboration being wrongly merged, so detection must be conservative by
  default. Configurable via env for tuning without a code change.
- `kind` equality is a cheap additional guard against merging across
  semantically different memory types that happen to embed closely.

## Merge action

For each matched pair, in one `db.transaction`:

1. Survivor = the row with the later `createdAt` (ties broken by `id` for
   determinism). Retired = the other.
2. Update retired row: `status = 'merged'`, `isLatest = false`,
   `updatedAt = now()`. **Not** `'superseded'` — `CONTEXT.md` is explicit
   that a duplicate must never supersede, and reusing `'superseded'` would
   make a merged duplicate indistinguishable from a contradiction-replaced
   memory in every status-based query and UI.
3. Insert a `memoryRelations` row:
   `{ userId, fromMemoryId: survivor.id, toMemoryId: retired.id, relationType: "merges" }`.
   Mirrors the existing `updates` edge shape (`fromMemoryId` is the one that
   acted, `toMemoryId` is the one acted upon) so relation-graph consumers
   generalize the same way.
4. No `version` bump, no `parentMemoryId`/`rootMemoryId` change on either
   row. A duplicate is not a content evolution of the survivor — the
   version/parent chain is reserved for supersession (ADR 0006) and stays
   untouched here.

`relation_type` is a plain `text` column (no enum, no migration needed to add
a new value — confirmed by how `"extends"` was previously dropped/could be
re-added without a migration, per `d8086b2e`). The `MemoryRelation` TypeScript
type in `routes/memory.ts` is a separate, narrower type scoped to the
turn-write path (`upsertMemory`); consolidation writes its relation directly
via `db.insert(memoryRelations)`, not through that type, so it does not need
widening.

## Self-limiting, no new column

Once a row's `status` flips to `'merged'` it fails the
`status = 'active'` join condition, so a merged pair can never be
rematched — no "already checked" marker column or migration required.
`LIMIT batchSize` bounds work per invocation the same way
`summarizeUnsummarizedSessions(batchSize)` bounds its per-tick work.

## Wiring

Added as a sixth sweep in `runCronSweeps()` (`apps/backend/src/index.ts`),
alongside `runDueSchedules`, `runPrivacyRetention`, `runDriveSyncSweep`,
`summarizeUnsummarizedSessions`, `renewExploreCredits` — same
`.then()/.catch()` result-logging pattern, same lazy `await import(...)`.

```ts
const { sweepMemoryConsolidation } = await import("./services/memory/consolidation.js")
// ...
sweepMemoryConsolidation()
  .then((count) => {
    if (count > 0) console.warn(`[memory-consolidation] merged ${count} pair(s)`)
  })
  .catch((err) => console.error("[memory-consolidation] sweep error:", err)),
```

## Error handling

- Per-pair transaction: one bad pair failing (e.g. a row deleted between the
  select and the update) does not abort the batch — wrap each pair's
  transaction in try/catch, log, continue.
- Whole-sweep failure (e.g. DB unreachable) is caught by the `runCronSweeps`
  `.catch()` already, consistent with every other sweep — best-effort by
  design, never blocks the other five sweeps in the `Promise.all`.

## Testing

New `apps/backend/src/services/memory/consolidation.test.ts`, following the
style of `agent-sessions.test.ts` / `contradiction.test.ts`:

- Two memories with near-identical embeddings (distance below threshold),
  same `kind` → merged; older gets `status='merged'`, `isLatest=false`;
  newer untouched; `merges` relation row written with correct direction.
- Two memories with distance above threshold → neither touched.
- Two memories same embedding but different `kind` → neither touched (kind
  guard).
- A memory already `status='merged'` → never selected as a candidate again
  (confirms self-limiting behavior without a marker column).
- `batchSize` caps the number of pairs processed in one call.

## Open questions / deliberately deferred

- Whether embedding-only detection catches enough real-world duplicates to
  matter, or whether it needs to fall back to the LLM-judge approach later
  (rejected for this iteration on cost/fairness grounds — see Goal). Revisit
  with real data after this ships.
- No admin/user-facing surface to inspect or undo a merge yet (the `merges`
  relation edge makes it inspectable via the existing relation-graph read
  path in `routes/memory.ts`, same as `updates` — no new UI work needed for
  reversibility, just no dedicated view highlighting it).
