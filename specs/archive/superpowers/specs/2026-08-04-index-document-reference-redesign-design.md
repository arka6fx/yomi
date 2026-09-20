# `index_document` reference-based redesign — closes #102 — design

Status: approved Date: 2026-08-04 Backlog ref: GitHub issue #102

## Problem

`index_document` (`packages/agent-core/src/index-document.ts`) requires the
agent model to re-emit an uploaded document's entire extracted text as a
tool-call argument (`content: z.string().min(1).max(100_000)`). The agent's
per-turn output-token budget (`apps/backend/src/agent/run.ts`'s
`maxOutputTokensFor()`, capped at ~6,000 tokens) is far below what a real
multi-page document needs — the upstream extraction (`gateway-runner.ts`'s
`parseDocument`) truncates at 50,000 characters. A document beyond roughly 5
pages either fails silently (`finishReason: "length"`, nothing indexed, no error
surfaced) or gets silently self-truncated by the model to fit its own budget.

A cheap mitigation already shipped (PR #105): `indexUploadedDocument` returns an
optional `warning` field when content is ≥15,000 characters, and the tool
description asks the model to relay it. This is a heuristic, not a fix — it both
false-positives (a genuinely-long document triggers the same warning as a
truncated one) and false-negatives (if the model self-truncates below 15,000
chars before calling the tool, no warning fires and the silent-partial-index
case still happens). Issue #102 was deliberately kept open to track the real
fix, which this spec designs.

## Root cause reframed

The original issue framed the fix as needing "new session-scoped storage with
its own expiry/concurrency design" — a cross-service problem. That assumption
doesn't hold: `apps/backend/src/gateway/gateway-runner.ts` (the Telegram message
handler) and `apps/backend/src/agent/run.ts` (where `runAgent()` wires up
`index_document`) run **in-process, in the same Bun/EC2 backend** —
`gateway-runner.ts` calls `runAgent()` via a plain function import
(`import { runAgent } from "../agent/run.js"`), not over any network boundary.
The document's full extracted text is already sitting in scope in the same call
graph, for the turn where the document arrives. `GatewayRunner` also already has
the exact storage pattern this needs:
`private conversationHistories: Map<string, ConversationEntry> = new Map()`,
keyed by `runKey(platform, chatId)`, with an existing `cleanupTimer`
(`SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000`) that periodically evicts stale
entries. No new subsystem is needed — this reuses that pattern.

## Goal

Eliminate the root cause, not mitigate it: the model never transports the
document's content through its own output tokens. `index_document`'s tool
interface drops the `content` parameter; the backend supplies the text directly
from what it already extracted server-side for that upload.

## Non-goals

- Preserving "index this document" across an unbounded number of later turns.
  Today, the extracted preview is only injected into `msg.text` for the single
  turn where the document arrives, and isn't specially preserved in later turns
  beyond whatever normal history retention/compression (`compressor.ts`) already
  does. This fix targets the realistic use case (upload, then ask to index in
  the same or next couple of messages) with a bounded TTL — it doesn't need to,
  and doesn't try to, make indexing work reliably an hour after upload.
- Multi-document tracking. If a user uploads document A then document B before
  asking to index either, the stash holds only the latest — matching today's
  behavior, where only the most recent upload's preview is in the model's
  immediate context anyway.
- Any change to `index_text`/`index_url` — neither is affected.
- Any change to the prompt-injection behavior in `gateway-runner.ts`
  (`[Document: name]\n{contentPreview}\n---\n{caption}`) — the model still needs
  a preview in its context to decide whether to act on the document at all. Only
  the tool's data source changes, not how the model learns a document exists.

## Architecture

`GatewayRunner` gains a new private field:

```ts
private pendingDocuments: Map<string, { title: string; content: string; storedAt: number }> = new Map()
```

keyed by the same `runKey(platform, chatId)` string already used for
`conversationHistories`. A new constant
`PENDING_DOCUMENT_TTL_MS = 15 * 60 * 1000` (15 minutes — short relative to
`HISTORY_TTL_MS`'s 1 hour, since a stashed document's payload is much larger
per-entry than a conversation turn, and the 15-minute window comfortably covers
"upload, then ask to index in the same or next couple of messages" without
holding large payloads in memory indefinitely). The existing `cleanupTimer`
sweep (which already runs every `SESSION_CLEANUP_INTERVAL_MS`) is extended to
also evict expired `pendingDocuments` entries, mirroring the existing
`conversationHistories` eviction loop.

`RunAgentOptions` (`apps/backend/src/agent/run.ts`) gains two new optional
fields — a consume-and-clear read, plus a restore for the failure path:

```ts
consumePendingDocument?: () => { title: string; content: string } | null
restorePendingDocument?: (document: { title: string; content: string }) => void
```

`consumePendingDocument` atomically returns the pending entry (or `null`) and
deletes it from `GatewayRunner`'s map in the same call — there is no separate
"peek" path, so a concurrent or repeated call within the same turn can't observe
and consume the same entry twice. `restorePendingDocument` re-inserts a
previously-consumed entry (used only on a failed index, so a transient failure
doesn't force the user to re-upload the file to retry). `gateway-runner.ts`
passes both as closures over its own map at the `runAgent()` call site on the
normal-message path. The other three call sites (`gateway-runner.ts`'s
resume/approval path, `services/mcp-server.ts`, `services/schedule-runner.ts`)
don't pass either — both stay `undefined`, and `index_document`'s wiring treats
a missing `consumePendingDocument` identically to "nothing pending."

`index_document`'s tool interface changes:

```ts
// packages/agent-core/src/index-document.ts
export type IndexDocumentResult =
  | { ok: true; documentId: string }
  | { error: string }
export type IndexDocumentFn = (title?: string) => Promise<IndexDocumentResult>
```

`content` is gone from both the Zod schema and the function signature. The model
may still optionally supply a `title` override (defaults to the stashed
filename); it never supplies document text.

## Data flow

In `gateway-runner.ts`'s document-handling block, immediately after
`parseDocument()` returns a non-null `contentPreview` (the existing success
path), store it:

```ts
this.pendingDocuments.set(this.runKey(msg.platform, msg.chatId), {
  title: docName,
  content: contentPreview,
  storedAt: Date.now(),
})
```

The existing prompt injection into `msg.text`
(`[Document: ${docName}]\n${contentPreview}\n\n---\n${msg.text}`) is unchanged —
the model still sees a preview and still decides whether to act.

At the `runAgent()` call site, pass:

```ts
consumePendingDocument: () => {
  const key = this.runKey(msg.platform, msg.chatId)
  const entry = this.pendingDocuments.get(key)
  if (!entry || Date.now() - entry.storedAt > PENDING_DOCUMENT_TTL_MS) return null
  this.pendingDocuments.delete(key)
  return { title: entry.title, content: entry.content }
},
```

This deletes-then-returns in one step — there is no separate "peek" path, so a
concurrent or repeated call within the same turn can't observe and consume the
same entry twice.

In `run.ts`, `index_document`'s injected function calls
`opts.consumePendingDocument?.()`. If it returns `null`/`undefined`, the tool
returns the "no recently uploaded document" error immediately without calling
`indexUploadedDocument` at all. Otherwise it calls
`indexUploadedDocument(opts.userId, title ?? pending.title, pending.content)`.
On success, nothing further is needed — the entry is already gone from the
stash. On failure (consent denial, `indexUploadedDocument` error), `run.ts`'s
wiring re-inserts the consumed `{ title, content }` back into `GatewayRunner`'s
map via a second small callback,
`restorePendingDocument?: (document: { title: string; content: string }) => void`,
also threaded through `RunAgentOptions` — so a transient failure doesn't force
the user to re-upload the file to retry. `restorePendingDocument` resets
`storedAt` to `Date.now()` on restore, giving the retry a fresh 15-minute window
rather than counting down from the original upload time.

## `indexUploadedDocument`'s `warning` field is removed

The `warning` field (and its `TRUNCATION_RISK_THRESHOLD_CHARS`/
`TRUNCATION_RISK_WARNING` constants in
`apps/backend/src/services/rag/document-source.ts`) becomes dead weight once
this ships: content always comes from the same 50,000-char-capped extraction
pipeline regardless of what the model does, so the "content may be a truncated
capture" heuristic no longer has a failure mode to detect — truncation now only
ever happens at the fixed 50,000-char extraction ceiling, which is a known,
already-documented limit, not a silent one. This spec removes the field and its
threshold logic rather than leave it as unreachable dead code.
`IndexDocumentResult`'s type correspondingly drops `warning?: string`.

## Error handling

- **No pending document** (stash empty, expired, or caller didn't pass
  `consumePendingDocument` at all):
  `{ error: "No recently uploaded document found — ask the user to re-upload it." }`,
  never throws — matches every other RAG tool's never-throws contract.
- **Consent denial / `indexDocument` failure**: unchanged from today's
  `indexUploadedDocument` behavior — `{ error: ... }`, stash entry preserved for
  a retry.
- **Successful index**: `{ ok: true, documentId }`, stash entry cleared.

## Testing

- `packages/agent-core/src/index-document.test.ts`: update for the new
  `(title?: string) => Promise<IndexDocumentResult>` signature — tool shape,
  callback invocation with an optional title (including the no-title case),
  error passthrough. Remove the now-obsolete `warning`-passthrough test.
- `apps/backend/src/services/rag/document-source.test.ts`: remove the two
  `warning`-threshold tests (content ≥/< 15,000 chars) added by PR #105 — the
  field no longer exists. Existing consent/error/success tests are otherwise
  unaffected, since `indexUploadedDocument`'s own signature
  `(userId, title, content)` doesn't change — only its caller in `run.ts`
  changes how it sources `content`.
- `apps/backend/src/agent/run.test.ts`: new tests for `index_document`'s wiring
  — a fake `consumePendingDocument` returning a document →
  `indexUploadedDocument` is called with the stash's content; a fake
  `consumePendingDocument` returning `null` (or the field left undefined/absent)
  → the tool returns the clear error without calling `indexUploadedDocument` at
  all; on a successful index, `restorePendingDocument` is never called; on a
  failed index (e.g. consent denied), a fake `restorePendingDocument` is called
  with the exact `{ title, content }` that was consumed.
- `apps/backend/src/gateway/gateway-runner.test.ts`: extend the file's existing
  `runAgent` mock (which already captures call arguments into `agentCalls`) to
  also capture `consumePendingDocument` and `restorePendingDocument`, then add
  tests: a successful document upload populates the stash such that the captured
  `consumePendingDocument` returns the extracted title/content on first call and
  `null` on a second call in the same turn (consumed-once semantics); a second,
  different chat's captured `consumePendingDocument` returns `null`
  (per-conversation isolation); calling the captured callback after the TTL
  window (simulated via a fake clock or a directly-expired `storedAt`) returns
  `null`; calling the captured `restorePendingDocument` makes a subsequent
  `consumePendingDocument` call return the restored entry again.

## Open questions / deliberately deferred

- 15 minutes is a judgment call on the TTL, not derived from usage data — may
  need tuning.
- If a future need arises for "index a document from N turns ago," that's a
  different feature (would need the stash to survive across a full conversation
  or persist to a database) — explicitly out of scope here.
