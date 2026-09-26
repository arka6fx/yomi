# `index_document` Reference-Based Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the root cause of GitHub issue #102 — `index_document` no
longer requires the agent model to re-emit a document's content as a tool-call
argument; the backend supplies it directly from what it already extracted
server-side.

**Architecture:** `GatewayRunner` stashes a just-extracted document's text in a
new short-lived in-memory map (mirroring its existing `conversationHistories`
map's key/TTL/cleanup pattern). Two callbacks (`consumePendingDocument`,
`restorePendingDocument`) thread through `RunAgentOptions` into `run.ts`. A new,
independently-testable helper (`resolvePendingDocumentIndex`) resolves
`index_document`'s tool call against the stash. The agent-core tool's Zod schema
drops `content` entirely.

**Tech Stack:** Bun, TypeScript, Hono, `ai` SDK's `tool()`/`zod`, `bun:test`.

## Global Constraints

- Spec:
  `specs/archive/superpowers/specs/2026-08-04-index-document-reference-redesign-design.md`
  — this plan implements it exactly; do not deviate without re-checking that
  file.
- **TTL:** exactly `PENDING_DOCUMENT_TTL_MS = 15 * 60 * 1000` (15 minutes), a
  fixed constant, not configurable.
- **Single slot per conversation:** the stash is keyed by
  `runKey(platform, chatId)` (same key scheme as `conversationHistories`) — a
  new upload overwrites any prior pending document for that conversation. No
  multi-document tracking.
- **Consume-and-clear semantics:** `consumePendingDocument()` atomically returns
  the pending entry (or `null`) and deletes it from the map in the same call —
  no separate "peek" path.
- **Restore-on-failure:** on a failed index (consent denial,
  `indexUploadedDocument` error), the consumed entry is re-inserted via
  `restorePendingDocument()` with a fresh `storedAt`, so a transient failure
  doesn't force a re-upload to retry. On success, nothing is restored — the
  entry stays consumed.
- **Double expiry check, matching the existing `conversationHistories` precedent
  exactly:** both a periodic sweep (in `cleanupSessions()`, alongside the
  existing `conversationHistories` eviction loop) AND a read-time check inside
  `consumePendingDocument()` itself (mirroring `conversationHistories`'s own
  read-time check:
  `if (!entry || Date.now() - entry.lastAt > HISTORY_TTL_MS) return []`).
- **No new callback fields visible to existing test assertions:**
  `apps/backend/src/gateway/gateway-runner.test.ts`'s existing `agentCalls`
  array and its `toEqual` assertions must not change shape — the two new
  callbacks are captured into separate module-level variables (mirroring exactly
  how `capturedOnReact` is already handled, not folded into `agentCalls`).
- **`warning` field removed entirely:** `IndexDocumentResult`,
  `indexUploadedDocument`'s return type, and the tool description's
  truncation-warning copy are all removed — content always comes from the same
  50,000-char-capped extraction pipeline now, so the heuristic has no failure
  mode left to detect.
- **Never throws:** `resolvePendingDocumentIndex` and every function in its call
  chain degrade to `{ error: string }`, matching every other RAG tool's
  contract.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `refactor:`),
  lowercase, no full stop, max 72 chars, per `AGENTS.md`.
- Test commands, run from repo root:
  - `bun test --isolate apps/backend/src/agent/pending-document.test.ts`
    (Task 1)
  - `bun test --isolate packages/agent-core/src/index-document.test.ts` (Task 2)
  - `bun test --isolate apps/backend/src/services/rag/document-source.test.ts`
    (Task 3)
  - `bun test --isolate apps/backend/src/agent/run.test.ts` (Task 4)
  - `bun test --isolate apps/backend/src/gateway/gateway-runner.test.ts`
    (Task 5)

---

## File Structure

- Create: `apps/backend/src/agent/pending-document.ts` — `PendingDocument` type,
  `ConsumePendingDocumentFn`/`RestorePendingDocumentFn` types,
  `resolvePendingDocumentIndex()`.
- Create: `apps/backend/src/agent/pending-document.test.ts` — tests for the
  above.
- Modify: `packages/agent-core/src/index-document.ts` — drop `content` from the
  Zod schema and `IndexDocumentFn`; drop `warning` from `IndexDocumentResult`;
  update the tool description.
- Modify: `packages/agent-core/src/index-document.test.ts` — update for the new
  signature; remove the obsolete warning-passthrough test.
- Modify: `apps/backend/src/services/rag/document-source.ts` — remove the
  `warning`/threshold logic from `indexUploadedDocument`.
- Modify: `apps/backend/src/services/rag/document-source.test.ts` — remove the
  two warning-threshold tests.
- Modify: `apps/backend/src/agent/run.ts` — `RunAgentOptions` gains
  `consumePendingDocument`/`restorePendingDocument`; `indexDocumentTool` wiring
  calls `resolvePendingDocumentIndex` instead of `indexUploadedDocument`
  directly.
- Modify: `apps/backend/src/agent/run.test.ts` — one new test verifying the
  wiring calls `resolvePendingDocumentIndex` with the right arguments.
- Modify: `apps/backend/src/gateway/gateway-runner.ts` — new `pendingDocuments`
  map, `PENDING_DOCUMENT_TTL_MS` constant, stash-write in the document-handling
  block, `consumePendingDocument`/`restorePendingDocument` private methods,
  wiring into the `runAgent()` call, `cleanupSessions()` extended.
- Modify: `apps/backend/src/gateway/gateway-runner.test.ts` — capture the two
  new callbacks; four new tests (stash populate + consume-once, per-conversation
  isolation, TTL expiry, restore-then-reconsume).

---

### Task 1: `pending-document.ts` — the resolver helper

**Files:**

- Create: `apps/backend/src/agent/pending-document.ts`
- Create: `apps/backend/src/agent/pending-document.test.ts`

**Interfaces:**

- Consumes: `indexUploadedDocument` from `../services/rag/document-source.js`
  (existing, signature
  `(userId: string, title: string, content: string) => Promise<{ ok: true; documentId: string } | { error: string }>`
  — unchanged by this task, changed by Task 3, but Task 3's change only removes
  the `warning` field from the success case, which this task's code never
  references, so ordering between Task 1 and Task 3 doesn't matter).
- Produces:

  ```ts
  export interface PendingDocument {
    title: string
    content: string
  }
  export type ConsumePendingDocumentFn = () => PendingDocument | null
  export type RestorePendingDocumentFn = (document: PendingDocument) => void
  export async function resolvePendingDocumentIndex(
    userId: string,
    title: string | undefined,
    consumePendingDocument: ConsumePendingDocumentFn | undefined,
    restorePendingDocument: RestorePendingDocumentFn | undefined,
  ): Promise<{ ok: true; documentId: string } | { error: string }>
  ```

  Task 4 consumes `PendingDocument`, `ConsumePendingDocumentFn`,
  `RestorePendingDocumentFn`, and `resolvePendingDocumentIndex` by these exact
  names and signatures.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/agent/pending-document.test.ts` with this content:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let indexUploadedDocumentResult:
  | { ok: true; documentId: string }
  | { error: string } = {
  ok: true,
  documentId: "doc-1",
}
let indexUploadedDocumentCalls: {
  userId: string
  title: string
  content: string
}[] = []
mock.module("../services/rag/document-source.js", () => ({
  indexUploadedDocument: async (
    userId: string,
    title: string,
    content: string,
  ) => {
    indexUploadedDocumentCalls.push({ userId, title, content })
    return indexUploadedDocumentResult
  },
}))

const { resolvePendingDocumentIndex } = await import("./pending-document.js")

beforeEach(() => {
  indexUploadedDocumentResult = { ok: true, documentId: "doc-1" }
  indexUploadedDocumentCalls = []
})

describe("resolvePendingDocumentIndex", () => {
  it("returns an error and does not call indexUploadedDocument when consumePendingDocument is undefined", async () => {
    const result = await resolvePendingDocumentIndex(
      "u1",
      undefined,
      undefined,
      undefined,
    )

    expect(result).toEqual({
      error:
        "No recently uploaded document found — ask the user to re-upload it.",
    })
    expect(indexUploadedDocumentCalls).toHaveLength(0)
  })

  it("returns an error and does not call indexUploadedDocument when consumePendingDocument returns null", async () => {
    const consume = () => null

    const result = await resolvePendingDocumentIndex(
      "u1",
      undefined,
      consume,
      undefined,
    )

    expect(result).toEqual({
      error:
        "No recently uploaded document found — ask the user to re-upload it.",
    })
    expect(indexUploadedDocumentCalls).toHaveLength(0)
  })

  it("calls indexUploadedDocument with the pending document's title/content when no title override is given", async () => {
    const consume = () => ({ title: "report.pdf", content: "extracted text" })

    const result = await resolvePendingDocumentIndex(
      "u1",
      undefined,
      consume,
      undefined,
    )

    expect(result).toEqual({ ok: true, documentId: "doc-1" })
    expect(indexUploadedDocumentCalls).toEqual([
      { userId: "u1", title: "report.pdf", content: "extracted text" },
    ])
  })

  it("uses the caller-supplied title override instead of the pending document's title", async () => {
    const consume = () => ({ title: "report.pdf", content: "extracted text" })

    await resolvePendingDocumentIndex(
      "u1",
      "My Custom Title",
      consume,
      undefined,
    )

    expect(indexUploadedDocumentCalls).toEqual([
      { userId: "u1", title: "My Custom Title", content: "extracted text" },
    ])
  })

  it("does not call restorePendingDocument on a successful index", async () => {
    const consume = () => ({ title: "report.pdf", content: "extracted text" })
    let restoreCalls: { title: string; content: string }[] = []
    const restore = (document: { title: string; content: string }) => {
      restoreCalls.push(document)
    }

    await resolvePendingDocumentIndex("u1", undefined, consume, restore)

    expect(restoreCalls).toHaveLength(0)
  })

  it("calls restorePendingDocument with the exact consumed document on a failed index", async () => {
    indexUploadedDocumentResult = { error: "cloud memory consent not granted" }
    const consume = () => ({ title: "report.pdf", content: "extracted text" })
    let restoreCalls: { title: string; content: string }[] = []
    const restore = (document: { title: string; content: string }) => {
      restoreCalls.push(document)
    }

    const result = await resolvePendingDocumentIndex(
      "u1",
      undefined,
      consume,
      restore,
    )

    expect(result).toEqual({ error: "cloud memory consent not granted" })
    expect(restoreCalls).toEqual([
      { title: "report.pdf", content: "extracted text" },
    ])
  })

  it("does not throw when restorePendingDocument is undefined and the index fails", async () => {
    indexUploadedDocumentResult = { error: "failed to index" }
    const consume = () => ({ title: "report.pdf", content: "extracted text" })

    const result = await resolvePendingDocumentIndex(
      "u1",
      undefined,
      consume,
      undefined,
    )

    expect(result).toEqual({ error: "failed to index" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/agent/pending-document.test.ts`
Expected: FAIL — `pending-document.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/backend/src/agent/pending-document.ts` with this content:

```ts
import { indexUploadedDocument } from "../services/rag/document-source.js"

export interface PendingDocument {
  title: string
  content: string
}

export type ConsumePendingDocumentFn = () => PendingDocument | null
export type RestorePendingDocumentFn = (document: PendingDocument) => void

// Resolves an index_document tool call against the turn's stashed upload (if any).
// The model never supplies document content — the backend already extracted it
// server-side; this is the seam between that stash and the actual indexer. On a
// failed index, the consumed entry is restored so a transient failure (e.g. a
// denied consent prompt) doesn't force the user to re-upload the file to retry.
export async function resolvePendingDocumentIndex(
  userId: string,
  title: string | undefined,
  consumePendingDocument: ConsumePendingDocumentFn | undefined,
  restorePendingDocument: RestorePendingDocumentFn | undefined,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  const pending = consumePendingDocument?.()
  if (!pending) {
    return {
      error:
        "No recently uploaded document found — ask the user to re-upload it.",
    }
  }

  const result = await indexUploadedDocument(
    userId,
    title ?? pending.title,
    pending.content,
  )
  if ("error" in result) {
    restorePendingDocument?.(pending)
  }
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/agent/pending-document.test.ts`
Expected: PASS — 7 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/agent/pending-document.ts apps/backend/src/agent/pending-document.test.ts
git commit -m "feat(agent): add resolvePendingDocumentIndex helper"
```

---

### Task 2: agent-core `index-document.ts` — drop `content`, drop `warning`

**Files:**

- Modify: `packages/agent-core/src/index-document.ts`
- Modify: `packages/agent-core/src/index-document.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  ```ts
  export type IndexDocumentResult =
    | { ok: true; documentId: string }
    | { error: string }
  export type IndexDocumentFn = (title?: string) => Promise<IndexDocumentResult>
  export function createIndexDocumentTool(indexDocument: IndexDocumentFn)
  ```
  Task 4 consumes `IndexDocumentFn`'s new signature — `run.ts`'s injected
  callback must accept an optional `title` and return
  `Promise<IndexDocumentResult>` with no `warning` field.

The current file (`packages/agent-core/src/index-document.ts`) reads:

```ts
import { tool } from "ai"
import { z } from "zod"

export type IndexDocumentResult =
  | { ok: true; documentId: string; warning?: string }
  | { error: string }
export type IndexDocumentFn = (
  title: string,
  content: string,
) => Promise<IndexDocumentResult>

export function createIndexDocumentTool(indexDocument: IndexDocumentFn) {
  return tool({
    description:
      "Index an uploaded document's content into the user's searchable cloud archive " +
      "so it can be found later by the deep_research tool. Use this when the user has " +
      "uploaded a PDF or Word document (its content will appear in your context as " +
      "'[Document: ...]') and asks you to remember, save, or index it. Very large " +
      "documents (roughly beyond a 5-page PDF) may not fit fully in this tool call — " +
      "if the result includes a warning, tell the user the indexed content may be a " +
      "partial capture of the original document.",
    parameters: z.object({
      title: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "A short, descriptive title — typically the document's filename",
        ),
      content: z
        .string()
        .min(1)
        .max(100_000)
        .describe("The document's extracted text content"),
    }),
    execute: async ({ title, content }) => indexDocument(title, content),
  })
}
```

- [ ] **Step 1: Write the failing tests**

Replace the full content of `packages/agent-core/src/index-document.test.ts`
with:

```ts
import { describe, expect, it } from "bun:test"
import {
  createIndexDocumentTool,
  type IndexDocumentFn,
} from "./index-document.js"

describe("createIndexDocumentTool", () => {
  it("returns a tool with the correct shape", () => {
    const indexDocument: IndexDocumentFn = async () => ({
      ok: true,
      documentId: "doc-1",
    })
    const t = createIndexDocumentTool(indexDocument)
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("document")
    expect(t.parameters).toBeDefined()
  })

  it("does not mention content or a size limit in the description, since the model never supplies content", () => {
    const indexDocument: IndexDocumentFn = async () => ({
      ok: true,
      documentId: "doc-1",
    })
    const t = createIndexDocumentTool(indexDocument)
    expect(t.description).not.toContain("content")
    expect(t.description).not.toContain("5-page")
  })

  it("calls the injected indexDocument callback with a caller-supplied title", async () => {
    let calledArgs: (string | undefined)[] = []
    const indexDocument: IndexDocumentFn = async (title) => {
      calledArgs.push(title)
      return { ok: true, documentId: "doc-1" }
    }
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!({ title: "report.pdf" }, {} as never)

    expect(calledArgs).toEqual(["report.pdf"])
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  it("calls the injected indexDocument callback with no title when the model omits it", async () => {
    let calledArgs: (string | undefined)[] = []
    const indexDocument: IndexDocumentFn = async (title) => {
      calledArgs.push(title)
      return { ok: true, documentId: "doc-1" }
    }
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!({}, {} as never)

    expect(calledArgs).toEqual([undefined])
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  it("passes an error result through unchanged", async () => {
    const indexDocument: IndexDocumentFn = async () => ({
      error: "failed to index",
    })
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!({ title: "report.pdf" }, {} as never)

    expect(result).toEqual({ error: "failed to index" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate packages/agent-core/src/index-document.test.ts`
Expected: FAIL — the current `execute` still requires `content` in its
parameters, and the description still mentions "content"/"5-page".

- [ ] **Step 3: Write the minimal implementation**

Replace the full content of `packages/agent-core/src/index-document.ts` with:

```ts
import { tool } from "ai"
import { z } from "zod"

export type IndexDocumentResult =
  | { ok: true; documentId: string }
  | { error: string }
export type IndexDocumentFn = (title?: string) => Promise<IndexDocumentResult>

export function createIndexDocumentTool(indexDocument: IndexDocumentFn) {
  return tool({
    description:
      "Index the most recently uploaded document (a PDF or Word file the user just sent " +
      "in chat, which appears in your context as '[Document: ...]') into the user's " +
      "searchable cloud archive so it can be found later by the deep_research tool. Call " +
      "this when the user asks you to remember, save, or index a document they just " +
      "uploaded — the backend already has its extracted text server-side, so you don't " +
      "supply it. Optionally pass a title to override the filename.",
    parameters: z.object({
      title: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "Optional short title to use instead of the document's filename",
        ),
    }),
    execute: async ({ title }) => indexDocument(title),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate packages/agent-core/src/index-document.test.ts`
Expected: PASS — 5 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/index-document.ts packages/agent-core/src/index-document.test.ts
git commit -m "feat(agent-core): drop content parameter from index_document tool"
```

---

### Task 3: `document-source.ts` — remove the `warning` heuristic

**Files:**

- Modify: `apps/backend/src/services/rag/document-source.ts`
- Modify: `apps/backend/src/services/rag/document-source.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  ```ts
  export async function indexUploadedDocument(
    userId: string,
    title: string,
    content: string,
  ): Promise<{ ok: true; documentId: string } | { error: string }>
  ```
  Signature unchanged from before this task — only the return type's success
  shape narrows (drops `warning?: string`). Task 1's
  `resolvePendingDocumentIndex` already expects exactly this narrowed shape.

The current file (`apps/backend/src/services/rag/document-source.ts`) reads:

```ts
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"
import { ensureSource } from "./source-lookup.js"

export const DOCUMENT_SOURCE_TYPE = "document"
const DOCUMENT_SOURCE_NAME = "Uploaded documents"
const DOCUMENT_SOURCE_PATH = "uploaded-documents"

function cleanTitle(value: string, max: number): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

export async function ensureDocumentSource(userId: string): Promise<string> {
  return ensureSource(userId, {
    path: DOCUMENT_SOURCE_PATH,
    name: DOCUMENT_SOURCE_NAME,
    sourceType: DOCUMENT_SOURCE_TYPE,
  })
}

const TRUNCATION_RISK_THRESHOLD_CHARS = 15_000
const TRUNCATION_RISK_WARNING =
  "This document may have been too large to index in full — the content indexed could be a partial capture of the original."

export async function indexUploadedDocument(
  userId: string,
  title: string,
  content: string,
): Promise<
  { ok: true; documentId: string; warning?: string } | { error: string }
> {
  try {
    const consent = await checkConsent(userId, "cloud_memory")
    if (!consent.allowed) {
      return {
        error: `cloud memory consent not granted${consent.reason ? `: ${consent.reason}` : ""}`,
      }
    }

    const sourceId = await ensureDocumentSource(userId)
    const result = await indexDocument({
      userId,
      sourceId,
      externalId: crypto.randomUUID(),
      title: cleanTitle(title, 200),
      mimeType: "text/plain",
      text: content,
    })
    if (!result.documentId) return { error: "failed to index" }
    return {
      ok: true,
      documentId: result.documentId,
      ...(content.length >= TRUNCATION_RISK_THRESHOLD_CHARS
        ? { warning: TRUNCATION_RISK_WARNING }
        : {}),
    }
  } catch (err) {
    console.error(
      "[indexUploadedDocument] failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return { error: "failed to index" }
  }
}
```

- [ ] **Step 1: Update the tests first**

In `apps/backend/src/services/rag/document-source.test.ts`, remove these two
tests entirely (they test behavior this task removes):

```ts
it("includes a warning when content is at or above the truncation-risk threshold", async () => {
  const longContent = "x".repeat(15_000)

  const result = await indexUploadedDocument("u1", "report.pdf", longContent)

  expect(result).toEqual({
    ok: true,
    documentId: "doc-1",
    warning:
      "This document may have been too large to index in full — the content indexed could be a partial capture of the original.",
  })
})

it("does not include a warning when content is below the truncation-risk threshold", async () => {
  const shortContent = "x".repeat(14_999)

  const result = await indexUploadedDocument("u1", "report.pdf", shortContent)

  expect(result).toEqual({ ok: true, documentId: "doc-1" })
  expect("warning" in result).toBe(false)
})
```

Leave every other test in the file exactly as-is (they don't reference `warning`
and remain valid).

- [ ] **Step 2: Run tests to verify the remaining ones still pass**

Run: `bun test --isolate apps/backend/src/services/rag/document-source.test.ts`
Expected: PASS — 8 tests remain (10 minus the 2 removed), 0 fail. (The
implementation hasn't changed yet, so this just confirms the removed tests
weren't load-bearing for anything else.)

- [ ] **Step 3: Remove the warning logic from the implementation**

Replace the full content of `apps/backend/src/services/rag/document-source.ts`
with:

```ts
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"
import { ensureSource } from "./source-lookup.js"

export const DOCUMENT_SOURCE_TYPE = "document"
const DOCUMENT_SOURCE_NAME = "Uploaded documents"
const DOCUMENT_SOURCE_PATH = "uploaded-documents"

function cleanTitle(value: string, max: number): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

// Idempotent get-or-create: every index_document call for a user reuses the same
// "Uploaded documents" source rather than creating a new one each time.
export async function ensureDocumentSource(userId: string): Promise<string> {
  return ensureSource(userId, {
    path: DOCUMENT_SOURCE_PATH,
    name: DOCUMENT_SOURCE_NAME,
    sourceType: DOCUMENT_SOURCE_TYPE,
  })
}

// Consent-gated wrapper around indexDocument() for agent-triggered document uploads.
// Never throws — a thrown error from checkConsent, ensureDocumentSource, or
// indexDocument would otherwise propagate out of the index_document tool's execute
// and kill the whole parent turn (same class of bug already fixed for
// delegate/deep_research/index_text/index_url), so the whole body — including the
// consent check — is guarded.
export async function indexUploadedDocument(
  userId: string,
  title: string,
  content: string,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  try {
    const consent = await checkConsent(userId, "cloud_memory")
    if (!consent.allowed) {
      return {
        error: `cloud memory consent not granted${consent.reason ? `: ${consent.reason}` : ""}`,
      }
    }

    const sourceId = await ensureDocumentSource(userId)
    const result = await indexDocument({
      userId,
      sourceId,
      externalId: crypto.randomUUID(),
      title: cleanTitle(title, 200),
      mimeType: "text/plain",
      text: content,
    })
    if (!result.documentId) return { error: "failed to index" }
    return { ok: true, documentId: result.documentId }
  } catch (err) {
    console.error(
      "[indexUploadedDocument] failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return { error: "failed to index" }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/rag/document-source.test.ts`
Expected: PASS — 8 tests, 0 fail.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck` Expected: 0 errors. (This will surface any other file
still referencing the now-removed `warning` field — there should be none outside
`run.ts`, which Task 4 updates.)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/services/rag/document-source.ts apps/backend/src/services/rag/document-source.test.ts
git commit -m "fix(rag): remove the truncation-warning heuristic from indexUploadedDocument"
```

---

### Task 4: Wire `resolvePendingDocumentIndex` into `run.ts`

**Files:**

- Modify: `apps/backend/src/agent/run.ts`
- Modify: `apps/backend/src/agent/run.test.ts`

**Interfaces:**

- Consumes: `PendingDocument`, `ConsumePendingDocumentFn`,
  `RestorePendingDocumentFn`, `resolvePendingDocumentIndex` from
  `./pending-document.js` (Task 1); `IndexDocumentFn`'s new
  `(title?: string) => Promise<IndexDocumentResult>` signature from
  `@yomi/agent-core` (Task 2, already exported from the package — confirmed
  `createIndexDocumentTool`/`IndexDocumentResult`/`IndexDocumentFn` are
  re-exported from `packages/agent-core/src/index.ts`, unchanged by this plan).
- Produces: `RunAgentOptions` gains
  `consumePendingDocument?: ConsumePendingDocumentFn` and
  `restorePendingDocument?: RestorePendingDocumentFn`. Task 5
  (`gateway-runner.ts`) consumes these two field names exactly when constructing
  its `runAgent()` call.

The current relevant sections of `apps/backend/src/agent/run.ts`:

Import block (lines 1-55), the two lines to change:

```ts
import { indexUploadedDocument } from "../services/rag/document-source.js"
```

(this import is removed — `run.ts` no longer calls `indexUploadedDocument`
directly)

`RunAgentOptions` (lines 57-72):

```ts
export interface RunAgentOptions {
  userId: string
  text: string
  history?: AgentMessage[]
  signal?: AbortSignal
  sourcePlatform?: string
  sourceChatId?: string
  // Set when resuming a turn the user already paid for — approving a gated write
  // re-enters the loop so the agent can finish its plan, and billing that "yes" as
  // a fresh message would charge a multi-write task once per approval.
  skipCharge?: boolean
  // When set, the agent gets a react_to_message tool that calls this to react to
  // the user's message. Only meaningful on platforms that support reactions
  // (Telegram) — omit on call sites that don't wire one up.
  onReact?: ReactFn
}
```

`indexDocumentTool` wiring (lines 590-594):

```ts
const indexDocumentTool = canUseRag
  ? createIndexDocumentTool((title, content) =>
      indexUploadedDocument(opts.userId, title, content),
    )
  : null
```

- [ ] **Step 1: Write the failing test**

In `apps/backend/src/agent/run.test.ts`, find the existing two `index_document`
tests (currently at lines 355-374):

```ts
it("wires an index_document tool into extraTools for a Pro-plan user", async () => {
  mockUser = makeUser({ plan: "pro" })
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  const indexDocumentTool = lastAgentExtraTools!["index_document"] as {
    execute?: unknown
    description?: string
  }
  expect(typeof indexDocumentTool.execute).toBe("function")
  expect(indexDocumentTool.description).toContain("document")
})

it("omits index_document from extraTools for an Explore-plan user", async () => {
  mockUser = makeUser({ plan: "explore" })
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  expect(lastAgentExtraTools!["index_document"]).toBeUndefined()
})
```

Leave both unchanged (they still pass under the new wiring — `execute` is still
a function, the description still contains "document"). Add one new test
immediately after them:

```ts
it("index_document's execute calls resolvePendingDocumentIndex with the turn's userId and callbacks", async () => {
  mockUser = makeUser({ plan: "pro" })
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  const indexDocumentTool = lastAgentExtraTools!["index_document"] as {
    execute: (args: { title?: string }, ctx: never) => Promise<unknown>
  }

  resolvePendingDocumentIndexCalls = []
  const result = await indexDocumentTool.execute(
    { title: "custom.pdf" },
    {} as never,
  )

  expect(resolvePendingDocumentIndexCalls).toEqual([
    {
      userId: "user_1",
      title: "custom.pdf",
      consumePendingDocument: undefined,
      restorePendingDocument: undefined,
    },
  ])
  expect(result).toEqual({ ok: true, documentId: "doc-1" })
})
```

This test needs a mock for `./pending-document.js`. Add it near the top of
`run.test.ts`, alongside the other `mock.module(...)` calls (after the existing
`mock.module("../services/privacy/checks.js", ...)` block, before
`function makeUser(...)`):

```ts
let resolvePendingDocumentIndexCalls: {
  userId: string
  title: string | undefined
  consumePendingDocument: unknown
  restorePendingDocument: unknown
}[] = []
mock.module("./pending-document.js", () => ({
  resolvePendingDocumentIndex: async (
    userId: string,
    title: string | undefined,
    consumePendingDocument: unknown,
    restorePendingDocument: unknown,
  ) => {
    resolvePendingDocumentIndexCalls.push({
      userId,
      title,
      consumePendingDocument,
      restorePendingDocument,
    })
    return { ok: true, documentId: "doc-1" }
  },
}))
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
`bun test --isolate apps/backend/src/agent/run.test.ts -t "resolvePendingDocumentIndex"`
Expected: FAIL — `run.ts` still imports and calls `indexUploadedDocument`
directly, not `resolvePendingDocumentIndex`, so the mock is never hit and
`resolvePendingDocumentIndexCalls` stays empty.

- [ ] **Step 3: Update `run.ts`**

Find this import line:

```ts
import { indexUploadedDocument } from "../services/rag/document-source.js"
```

Replace it with:

```ts
import {
  resolvePendingDocumentIndex,
  type ConsumePendingDocumentFn,
  type RestorePendingDocumentFn,
} from "./pending-document.js"
```

Find the `RunAgentOptions` interface and add the two new fields after `onReact`:

```ts
export interface RunAgentOptions {
  userId: string
  text: string
  history?: AgentMessage[]
  signal?: AbortSignal
  sourcePlatform?: string
  sourceChatId?: string
  // Set when resuming a turn the user already paid for — approving a gated write
  // re-enters the loop so the agent can finish its plan, and billing that "yes" as
  // a fresh message would charge a multi-write task once per approval.
  skipCharge?: boolean
  // When set, the agent gets a react_to_message tool that calls this to react to
  // the user's message. Only meaningful on platforms that support reactions
  // (Telegram) — omit on call sites that don't wire one up.
  onReact?: ReactFn
  // When set, index_document consumes the turn's stashed upload through this pair
  // instead of requiring the model to supply document content — only the gateway's
  // normal-message path has a document to offer, so every other caller omits both.
  consumePendingDocument?: ConsumePendingDocumentFn
  restorePendingDocument?: RestorePendingDocumentFn
}
```

Find the `indexDocumentTool` wiring and replace it:

```ts
const indexDocumentTool = canUseRag
  ? createIndexDocumentTool((title, content) =>
      indexUploadedDocument(opts.userId, title, content),
    )
  : null
```

becomes:

```ts
const indexDocumentTool = canUseRag
  ? createIndexDocumentTool((title) =>
      resolvePendingDocumentIndex(
        opts.userId,
        title,
        opts.consumePendingDocument,
        opts.restorePendingDocument,
      ),
    )
  : null
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test --isolate apps/backend/src/agent/run.test.ts` Expected: PASS —
all existing tests plus the 1 new one.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck` Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/agent/run.ts apps/backend/src/agent/run.test.ts
git commit -m "feat(agent): wire resolvePendingDocumentIndex into index_document"
```

---

### Task 5: `gateway-runner.ts` — the stash itself

**Files:**

- Modify: `apps/backend/src/gateway/gateway-runner.ts`
- Modify: `apps/backend/src/gateway/gateway-runner.test.ts`

**Interfaces:**

- Consumes: `ConsumePendingDocumentFn`, `RestorePendingDocumentFn`,
  `PendingDocument` type shapes from Task 1 (structural match, not imported —
  `gateway-runner.ts` doesn't import from `pending-document.ts`; its closures
  just happen to match the shape `RunAgentOptions` expects).
- Produces: nothing new for later tasks — this is the final integration point.

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/gateway/gateway-runner.test.ts`, find the `runAgent` mock
(currently at lines 94-123):

```ts
mock.module("../agent/run.js", () => ({
  runAgent: async ({
    userId,
    text,
    history,
    signal,
    skipCharge,
    onReact,
  }: {
    userId: string
    text: string
    history?: AgentMessage[]
    signal?: AbortSignal
    skipCharge?: boolean
    onReact?: (emoji: string) => Promise<void>
  }) => {
    agentCalls.push({ userId, text, history, signal, skipCharge })
    capturedOnReact = onReact
    if (agentHangs) {
      // Mimic the real runAgent: when the abort signal fires it stops and
      // returns (it does not throw), yielding no usable text.
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve()
        signal?.addEventListener("abort", () => resolve())
      })
      return { text: "" }
    }
    return { text: "backend reply" }
  },
}))
```

Replace it with (adds the two new params to the destructured type, captures them
into new module-level variables — `agentCalls`'s pushed object is unchanged, so
no existing `toEqual` assertion breaks):

```ts
mock.module("../agent/run.js", () => ({
  runAgent: async ({
    userId,
    text,
    history,
    signal,
    skipCharge,
    onReact,
    consumePendingDocument,
    restorePendingDocument,
  }: {
    userId: string
    text: string
    history?: AgentMessage[]
    signal?: AbortSignal
    skipCharge?: boolean
    onReact?: (emoji: string) => Promise<void>
    consumePendingDocument?: () => { title: string; content: string } | null
    restorePendingDocument?: (document: {
      title: string
      content: string
    }) => void
  }) => {
    agentCalls.push({ userId, text, history, signal, skipCharge })
    capturedOnReact = onReact
    capturedConsumePendingDocument = consumePendingDocument
    capturedRestorePendingDocument = restorePendingDocument
    if (agentHangs) {
      // Mimic the real runAgent: when the abort signal fires it stops and
      // returns (it does not throw), yielding no usable text.
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve()
        signal?.addEventListener("abort", () => resolve())
      })
      return { text: "" }
    }
    return { text: "backend reply" }
  },
}))
```

Add the two new module-level capture variables near the top of the file,
alongside the existing
`let capturedOnReact: ((emoji: string) => Promise<void>) | undefined` line:

```ts
let capturedConsumePendingDocument:
  | (() => { title: string; content: string } | null)
  | undefined
let capturedRestorePendingDocument:
  | ((document: { title: string; content: string }) => void)
  | undefined
```

Add both to the existing `beforeEach` reset block, alongside
`capturedOnReact = undefined`:

```ts
capturedConsumePendingDocument = undefined
capturedRestorePendingDocument = undefined
```

Then add these four new tests inside the existing
`describe("GatewayRunner production routing", ...)` block, after the last
existing test in that block (find the block's closing — add before its final
`})`):

```ts
it("stashes an uploaded document's extracted text so index_document can consume it once", async () => {
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)
  globalThis.fetch = (async () =>
    new Response("Hello world content", { status: 200 })) as typeof fetch

  await incoming(runner, {
    platform: "telegram",
    chatId: "chat_1",
    userId: "tg_1",
    text: "",
    timestamp: new Date().toISOString(),
    documentUrl: "https://example.com/notes.txt",
    documentFileName: "notes.txt",
    documentMimeType: "text/plain",
  })

  expect(capturedConsumePendingDocument).toBeDefined()
  expect(capturedConsumePendingDocument!()).toEqual({
    title: "notes.txt",
    content: "Hello world content",
  })
  // Consumed once — a second call finds nothing left to return.
  expect(capturedConsumePendingDocument!()).toBeNull()
})

it("keeps a stashed document scoped to its own conversation", async () => {
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)
  globalThis.fetch = (async () =>
    new Response("Chat 1's document", { status: 200 })) as typeof fetch

  await incoming(runner, {
    platform: "telegram",
    chatId: "chat_1",
    userId: "tg_1",
    text: "",
    timestamp: new Date().toISOString(),
    documentUrl: "https://example.com/notes.txt",
    documentFileName: "notes.txt",
    documentMimeType: "text/plain",
  })

  await incoming(runner, {
    platform: "telegram",
    chatId: "chat_2",
    userId: "tg_2",
    text: "index the document",
    timestamp: new Date().toISOString(),
  })

  expect(capturedConsumePendingDocument).toBeDefined()
  expect(capturedConsumePendingDocument!()).toBeNull()
})

it("expires a stashed document after PENDING_DOCUMENT_TTL_MS", async () => {
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)
  globalThis.fetch = (async () =>
    new Response("Old content", { status: 200 })) as typeof fetch

  await incoming(runner, {
    platform: "telegram",
    chatId: "chat_1",
    userId: "tg_1",
    text: "",
    timestamp: new Date().toISOString(),
    documentUrl: "https://example.com/notes.txt",
    documentFileName: "notes.txt",
    documentMimeType: "text/plain",
  })

  const consume = capturedConsumePendingDocument!
  const realDateNow = Date.now
  Date.now = () => realDateNow() + 16 * 60 * 1000
  try {
    expect(consume()).toBeNull()
  } finally {
    Date.now = realDateNow
  }
})

it("makes a restored document consumable again", async () => {
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)
  globalThis.fetch = (async () =>
    new Response("Retry me", { status: 200 })) as typeof fetch

  await incoming(runner, {
    platform: "telegram",
    chatId: "chat_1",
    userId: "tg_1",
    text: "",
    timestamp: new Date().toISOString(),
    documentUrl: "https://example.com/notes.txt",
    documentFileName: "notes.txt",
    documentMimeType: "text/plain",
  })

  const consume = capturedConsumePendingDocument!
  const restore = capturedRestorePendingDocument!
  const consumed = consume()
  expect(consumed).toEqual({ title: "notes.txt", content: "Retry me" })
  expect(consume()).toBeNull()

  restore(consumed!)

  expect(consume()).toEqual({ title: "notes.txt", content: "Retry me" })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`bun test --isolate apps/backend/src/gateway/gateway-runner.test.ts -t "pending document|PENDING_DOCUMENT_TTL_MS|consume it once|own conversation|consumable again"`
Expected: FAIL — `capturedConsumePendingDocument` is never set
(`gateway-runner.ts` doesn't pass
`consumePendingDocument`/`restorePendingDocument` to `runAgent()` yet), so
`capturedConsumePendingDocument` stays `undefined` and calling it throws.

- [ ] **Step 3: Implement the stash in `gateway-runner.ts`**

Find the constants block near the top of the file:

```ts
const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const LINK_CODE_TTL_MS = 10 * 60 * 1000
const HISTORY_MAX_TURNS = 8
const HISTORY_TTL_MS = 60 * 60 * 1000
const SHARED_SESSION_PLATFORM = "yomi"
const SHARED_SESSION_CHAT_ID = "global"
```

Add one new constant after `HISTORY_TTL_MS`:

```ts
const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const LINK_CODE_TTL_MS = 10 * 60 * 1000
const HISTORY_MAX_TURNS = 8
const HISTORY_TTL_MS = 60 * 60 * 1000
// Short relative to HISTORY_TTL_MS: a stashed document's payload (up to 50,000 chars)
// is much larger per-entry than a conversation turn, and 15 minutes comfortably
// covers "upload, then ask to index in the same or next couple of messages" without
// holding large payloads in memory indefinitely.
const PENDING_DOCUMENT_TTL_MS = 15 * 60 * 1000
const SHARED_SESSION_PLATFORM = "yomi"
const SHARED_SESSION_CHAT_ID = "global"
```

Add a new interface near `ConversationEntry`:

```ts
interface ConversationEntry {
  turns: AgentMessage[]
  lastAt: number
}

interface PendingDocumentEntry {
  title: string
  content: string
  storedAt: number
}
```

Add a new private field to the class, alongside `conversationHistories`:

```ts
export class GatewayRunner {
  private adapters: Map<PlatformType, PlatformAdapter> = new Map()
  private sessions: Map<string, GatewaySession> = new Map()
  private conversationHistories: Map<string, ConversationEntry> = new Map()
  private pendingDocuments: Map<string, PendingDocumentEntry> = new Map()
  private activeRuns: Map<string, AbortController> = new Map()
```

Add two new private methods, near the existing `private runKey(...)` method:

```ts
  private runKey(platform: PlatformType, chatId: string): string {
    return `${platform}:${chatId}`
  }

  // Atomically returns and deletes the conversation's pending document — there is
  // no separate "peek" path, so a repeated or concurrent call within the same turn
  // can't observe and consume the same entry twice.
  private consumePendingDocument(
    platform: PlatformType,
    chatId: string,
  ): { title: string; content: string } | null {
    const key = this.runKey(platform, chatId)
    const entry = this.pendingDocuments.get(key)
    if (!entry || Date.now() - entry.storedAt > PENDING_DOCUMENT_TTL_MS) return null
    this.pendingDocuments.delete(key)
    return { title: entry.title, content: entry.content }
  }

  // Re-inserts a previously-consumed document, used only after a failed index so a
  // transient failure doesn't force the user to re-upload the file to retry. Resets
  // storedAt so the retry gets a fresh TTL window rather than counting down from the
  // original upload time.
  private restorePendingDocument(
    platform: PlatformType,
    chatId: string,
    document: { title: string; content: string },
  ): void {
    this.pendingDocuments.set(this.runKey(platform, chatId), {
      title: document.title,
      content: document.content,
      storedAt: Date.now(),
    })
  }
```

Find the document-handling block's success path:

```ts
            if (contentPreview) {
              if (msg.text.trim()) {
                msg = {
                  ...msg,
                  text: `[Document: ${docName}]\n${contentPreview}\n\n---\n${msg.text}`,
                }
              } else {
                msg = { ...msg, text: `[Document: ${docName}]\n${contentPreview}` }
              }
            } else {
```

Change it to also stash the extracted text:

```ts
            if (contentPreview) {
              this.pendingDocuments.set(this.runKey(msg.platform, msg.chatId), {
                title: docName,
                content: contentPreview,
                storedAt: Date.now(),
              })
              if (msg.text.trim()) {
                msg = {
                  ...msg,
                  text: `[Document: ${docName}]\n${contentPreview}\n\n---\n${msg.text}`,
                }
              } else {
                msg = { ...msg, text: `[Document: ${docName}]\n${contentPreview}` }
              }
            } else {
```

Find the `runAgent()` call site:

```ts
const result = await runAgent({
  userId: yomiUserId,
  text: msg.text,
  history,
  signal: runController.signal,
  sourcePlatform: msg.platform,
  sourceChatId: msg.chatId,
  onReact: (emoji) =>
    msg.messageId
      ? this.setReaction(msg.platform, msg.chatId, msg.messageId, emoji)
      : Promise.resolve(),
})
```

Add the two new options:

```ts
const result = await runAgent({
  userId: yomiUserId,
  text: msg.text,
  history,
  signal: runController.signal,
  sourcePlatform: msg.platform,
  sourceChatId: msg.chatId,
  onReact: (emoji) =>
    msg.messageId
      ? this.setReaction(msg.platform, msg.chatId, msg.messageId, emoji)
      : Promise.resolve(),
  consumePendingDocument: () =>
    this.consumePendingDocument(msg.platform, msg.chatId),
  restorePendingDocument: (document) =>
    this.restorePendingDocument(msg.platform, msg.chatId, document),
})
```

Find `cleanupSessions()`:

```ts
  private cleanupSessions(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > SESSION_TTL_MS) {
        this.sessions.delete(id)
      }
    }
    for (const [key, entry] of this.conversationHistories) {
      if (now - entry.lastAt > HISTORY_TTL_MS) {
        this.conversationHistories.delete(key)
      }
    }
  }
```

Extend it:

```ts
  private cleanupSessions(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > SESSION_TTL_MS) {
        this.sessions.delete(id)
      }
    }
    for (const [key, entry] of this.conversationHistories) {
      if (now - entry.lastAt > HISTORY_TTL_MS) {
        this.conversationHistories.delete(key)
      }
    }
    for (const [key, entry] of this.pendingDocuments) {
      if (now - entry.storedAt > PENDING_DOCUMENT_TTL_MS) {
        this.pendingDocuments.delete(key)
      }
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test --isolate apps/backend/src/gateway/gateway-runner.test.ts`
Expected: PASS — all existing tests plus the 4 new ones.

- [ ] **Step 5: Typecheck and run the full backend + agent-core suites**

Run: `bun run typecheck` Expected: 0 errors.

Run: `bun test --isolate packages/agent-core/src` Expected: all pass.

Run: `bun test --isolate apps/backend/src` Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/gateway/gateway-runner.ts apps/backend/src/gateway/gateway-runner.test.ts
git commit -m "feat(gateway): stash extracted document text for index_document"
```

---

## Final Verification

- [ ] Run `bun run format` proactively before pushing (every PR this session has
      needed this at least once), then re-verify tests still pass.
- [ ] Run `bun run lint`.
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate` (full monorepo suite) from repo root — all pass.
- [ ] Re-read
      `specs/archive/superpowers/specs/2026-08-04-index-document-reference-redesign-design.md`
      and confirm every section (architecture, data flow, warning-field removal,
      error handling, testing) has a corresponding implemented piece.
- [ ] Manually confirm: no remaining references to `warning` in
      `IndexDocumentResult`/`indexUploadedDocument`'s call sites anywhere in the
      codebase
      (`grep -rn "warning" packages/agent-core/src/index-document.ts apps/backend/src/services/rag/document-source.ts`
      should show nothing beyond what typecheck already caught).
