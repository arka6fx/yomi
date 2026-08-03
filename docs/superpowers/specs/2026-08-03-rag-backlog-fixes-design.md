# RAG backlog fixes — #100 and #102 — design

Status: approved Date: 2026-08-03 Backlog ref: GitHub issues #100, #102 (filed
during backlog item 10's final reviews)

## Problem

Two follow-up bugs were filed during item 10's (RAG ingestion) final reviews and
left open as tracked issues rather than fixed inline, since neither blocked the
branches they were found on. This is the wrap-up pass closing both out.

**#100:** `DELETE /rag/sources/:id` (`apps/backend/src/routes/rag.ts`) only sets
`status: "deleted"` on the `ragSources` row — it never deletes the row's
`rag_documents`/`rag_chunks`. The shared `ensureSource()` helper
(`apps/backend/src/services/rag/source-lookup.ts`, used by `index_text`,
`index_url`, and `index_document`) resurrects a soft-deleted row back to
`status: "ready"` when a later ingestion call conflicts on the same
`(userId, path)` slot. Because the old row's documents/chunks were never
actually removed, every previously "deleted" document in that bucket becomes
searchable again the moment the user re-indexes anything into the same bucket —
silently, with no signal the deletion was undone.

**#102:** `index_document` requires the agent model to re-emit an entire
uploaded document's extracted text as a tool-call argument
(`content: z.string().min(1).max(100_000)` in
`packages/agent-core/src/index-document.ts`). The agent's per-turn output token
budget (`apps/backend/src/agent/run.ts`'s `maxOutputTokensFor()`, capped at
6,000 tokens after scaling — confirmed by reading the function: `base` maxes at
4000, `scale` maxes at 1.5) is well below what a real document needs — the
upstream extraction pipeline (`gateway-runner.ts`'s
`parseDocument`/`document-extract.ts`'s `extractTextViaDrive`) truncates at
50,000 characters. Realistically, anything past roughly a 5-page PDF can't fit
in one tool-call argument, and the failure is silent: either the model hits
`finishReason: "length"` mid-call (nothing indexed, no error surfaced) or
self-truncates the content to fit (a silently partial document gets archived as
if complete).

## Goal

Close both issues with the smallest fix that removes the actual harm:

- **#100:** the resurrection hole is closed entirely — a soft-deleted source's
  documents/chunks are gone for good, matching what "delete this source" should
  mean.
- **#102:** the silent-failure mode becomes a visible one. The full
  architectural fix (agent passes a document reference, backend re-pulls
  already-extracted text from a new server-side stash) is explicitly out of
  scope for this pass — it requires new session-scoped storage with its own
  expiry/concurrency design, which is a separate, larger effort. This pass ships
  the cheap mitigation instead: a tool-description warning plus a length-based
  heuristic flag on the result.

## Non-goals

- The reference-based redesign of `index_document`'s interface (deferred; no new
  issue needed — #102 itself already documents this as the "clean fix" for
  whenever it's prioritized).
- Any change to `index_text`/`index_url`'s behavior — neither is affected by
  either fix.
- A precise, non-heuristic way to detect truncation in #102. The length-based
  flag is a best-effort signal, not a guarantee — a document that's genuinely
  exactly that long triggers the same warning as one that was actually cut
  short. This is an accepted trade-off of the "cheap mitigation" scope.

## Fix 1: hard-delete on `DELETE /sources/:id`

`apps/backend/src/routes/rag.ts` already has the exact pattern to mirror, in the
same file, one function above the route:

```ts
async function deleteMirrorSource(
  userId: string,
  name: string,
): Promise<boolean> {
  const source = await findSource(userId, name)
  if (!source) return false
  await db.delete(ragDocuments).where(eq(ragDocuments.sourceId, source.id))
  await db
    .update(ragSources)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(ragSources.id, source.id))
  return true
}
```

The route becomes: look up the source by id+userId (as it already does), delete
`ragDocuments` where `sourceId` matches, then perform the existing status
update. Confirmed via `packages/db/src/schema.ts` that no additional cascade
wiring is needed: `rag_documents.source_id` → `rag_sources.id`
(`onDelete: "cascade"`), `rag_chunks.document_id` → `rag_documents.id`
(`onDelete: "cascade"`), `rag_embeddings.chunk_id` → `rag_chunks.id`
(`onDelete: "cascade"`) — a single `db.delete(ragDocuments)` call cascades
through chunks and embeddings automatically at the database level.

Ordering: delete documents _before_ the status-update returns 404-on-missing
check needs to still work correctly — the existing route already does the
`update...returning` first to confirm the row exists and belongs to the user, so
the document delete is inserted as a new step between confirming ownership and
returning success. Exact ordering is decided in the plan; the important
constraint is that a 404 (source not found / not owned) must not delete anyone's
documents.

## Fix 2: `index_document` size-ceiling mitigation

**Tool description** (`packages/agent-core/src/index-document.ts`): add a
sentence noting the practical size ceiling so the model can proactively warn the
user rather than claim silent success on a large document.

**Result shape and heuristic**
(`apps/backend/src/services/rag/document-source.ts`): `indexUploadedDocument`'s
success variant gains an optional `warning?: string` field. Threshold:
`content.length >= 15_000` — chosen as comfortably above what a typical
short-to-medium document produces, and at the edge of what a ~6,000-token output
budget can realistically produce in one tool call (~4 chars/token is a common
rough approximation, so 6,000 tokens ≈ 24,000 characters is the practical
ceiling before accounting for JSON/tool-call structure overhead; 15,000 is a
conservative buffer below that). When triggered, the warning text explains the
content may be a partial/truncated capture of the source document, so the model
can relay that caveat to the user instead of a bare "saved it."

`IndexDocumentResult`'s type (`packages/agent-core/src/index-document.ts`) gains
the same optional `warning?: string` on its success variant, so the tool's
return value carries the flag through to the model.

## Testing

- `apps/backend/src/routes/rag.test.ts`: extend the DELETE test setup to track
  calls to `db.delete(...)` (the existing `fakeDb.delete` mock currently
  discards its argument — needs a `deleteCalls` tracking array, matching the
  existing `insertValues`/`updateRows` tracking pattern already in the file),
  then add a test asserting `ragDocuments` is deleted with the correct
  `sourceId` before the source is marked deleted, plus a test confirming the
  existing 404-on-missing-source path still does not call delete at all (no
  delete happens for a source that isn't found/owned).
- `apps/backend/src/services/rag/document-source.test.ts`: add a test for
  content at/above the 15,000-char threshold returning a `warning` field, and a
  test for content below it returning no `warning` field (undefined or absent),
  keeping the existing tests (which use short content) as the implicit "no
  warning by default" baseline.
- `packages/agent-core/src/index-document.test.ts`: add a test confirming the
  tool passes through a `warning` field from the injected `indexDocument`
  callback's result unchanged (mirrors the existing error-passthrough test's
  shape).

## Open questions / deliberately deferred

- The 15,000-character threshold is a judgment call, not derived from a hard
  measurement of the actual JSON/tool-call framing overhead — it may need tuning
  based on real usage.
- The reference-based redesign for #102 remains open; this pass does not attempt
  it.
