# RAG Backlog Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close GitHub issues #100 (soft-deleted RAG source resurrects its documents) and #102 (`index_document` silently truncates on large documents) with the smallest fix that removes the actual harm.

**Architecture:** Two independent, small fixes in the existing RAG ingestion codebase — no new files, no new architecture. #100 mirrors an existing hard-delete pattern already in the same file. #102 adds a tool-description warning plus a length-heuristic flag threaded through the existing `IndexDocumentResult` type.

**Tech Stack:** Hono, Drizzle ORM, TypeScript, `bun:test`, `ai` SDK's `tool()`/`zod`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-rag-backlog-fixes-design.md` — this plan implements it exactly; do not deviate without re-checking that file.
- **#100 ordering constraint:** documents must be deleted only for a source that is confirmed to exist and belong to the calling user — a 404 (source not found / not owned) must not delete anyone's documents. The existing route's `update(ragSources)...returning()` call already does this ownership check as a side effect of the status update; the document delete must be sequenced so it only happens for a row that update actually touched.
- **#100 cascade:** no explicit `rag_chunks`/`rag_embeddings` deletion is needed — `packages/db/src/schema.ts` already defines `rag_chunks.document_id → rag_documents.id` and `rag_embeddings.chunk_id → rag_chunks.id` as `onDelete: "cascade"`, so deleting the `rag_documents` rows cascades through both automatically at the database level.
- **#102 threshold:** exactly `15_000` characters (`content.length >= 15_000`), a fixed constant, not user-configurable.
- **#102 never breaks existing behavior:** the `warning` field must be *conditionally spread* into the result object — never assigned as `warning: undefined` — so every existing test asserting `toEqual({ ok: true, documentId: "doc-1" })` (with short test content, always under the threshold) continues to pass unchanged.
- Conventional commit messages (`fix:`, `test:`), lowercase, no full stop, max 72 chars, per `AGENTS.md`.
- Test commands, run from repo root:
  - `bun test --isolate apps/backend/src/routes/rag.test.ts` (Task 1)
  - `bun test --isolate apps/backend/src/services/rag/document-source.test.ts` (Task 2)
  - `bun test --isolate packages/agent-core/src/index-document.test.ts` (Task 3)

---

## File Structure

- Modify: `apps/backend/src/routes/rag.ts` — the `DELETE /sources/:id` route hard-deletes `ragDocuments` before marking the source deleted.
- Modify: `apps/backend/src/routes/rag.test.ts` — track `db.delete(...)` calls; add tests for the new delete behavior and the 404-doesn't-delete-anything guarantee.
- Modify: `apps/backend/src/services/rag/document-source.ts` — `indexUploadedDocument` computes and conditionally includes a `warning` field based on content length.
- Modify: `apps/backend/src/services/rag/document-source.test.ts` — add tests for the warning threshold (present above it, absent below it).
- Modify: `packages/agent-core/src/index-document.ts` — `IndexDocumentResult`'s success variant gains an optional `warning?: string`; tool description gets a size-ceiling warning sentence.
- Modify: `packages/agent-core/src/index-document.test.ts` — add a test confirming `warning` passes through unchanged when present.

---

### Task 1: Hard-delete on `DELETE /sources/:id` (closes #100)

**Files:**
- Modify: `apps/backend/src/routes/rag.ts:408-422`
- Modify: `apps/backend/src/routes/rag.test.ts`

**Interfaces:**
- Consumes: `db`, `ragDocuments`, `ragSources`, `eq`, `and` — all already imported at the top of `rag.ts` (confirmed: `import { and, eq, sql } from "drizzle-orm"` and `import { db, ragChunks, ragDocuments, ragEmbeddings, ragRetrievalLogs, ragSources } from "@yomi/db"` are both already present).
- Produces: nothing new for later tasks — this task is self-contained.

The current route (`apps/backend/src/routes/rag.ts:408-422`) reads:

```ts
ragRouter.delete("/sources/:id", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const id = c.req.param("id")
  const [source] = await db
    .update(ragSources)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(ragSources.id, id), eq(ragSources.userId, user.id)))
    .returning({ id: ragSources.id })

  if (!source) return c.json({ error: "Source not found", code: "source_not_found" }, 404)
  return c.json({ ok: true })
})
```

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/routes/rag.test.ts`, the shared `fakeDb` mock (near the top of the file) currently has:

```ts
  delete: () => ({
    where: () => Promise.resolve(),
  }),
```

Change it to track calls, matching the existing `insertValues`/`updateRows` tracking pattern:

```ts
  delete: (table?: unknown) => ({
    where: (condition: unknown) => {
      deleteCalls.push({ table, condition })
      return Promise.resolve()
    },
  }),
```

Add the tracking array declaration near the top of the file, alongside the existing `let insertValues: unknown[] = []` line:

```ts
let deleteCalls: { table: unknown; condition: unknown }[] = []
```

Add it to the `beforeEach` reset block (alongside the existing `insertValues = []` reset):

```ts
    deleteCalls = []
```

Then, in the existing `describe("Cloud RAG routes", ...)` block, find the two existing DELETE-related tests:

```ts
  it("soft-deletes a source owned by the current user", async () => {
    const res = await app().request("/api/rag/sources/source_1", { method: "DELETE" })
    const body = (await res.json()) as { ok?: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it("returns not found when deleting an unknown source", async () => {
    updateRows = []

    const res = await app().request("/api/rag/sources/missing", { method: "DELETE" })
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(404)
    expect(body.code).toBe("source_not_found")
  })
```

Replace them with (the first test gains an assertion on the new delete call; the second gains an assertion that no delete call happens at all):

```ts
  it("soft-deletes a source owned by the current user", async () => {
    const res = await app().request("/api/rag/sources/source_1", { method: "DELETE" })
    const body = (await res.json()) as { ok?: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it("hard-deletes the source's documents (and cascading chunks/embeddings) before marking it deleted", async () => {
    const res = await app().request("/api/rag/sources/source_1", { method: "DELETE" })

    expect(res.status).toBe(200)
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0]!.table).toBe(mockRagDocuments)
  })

  it("returns not found when deleting an unknown source", async () => {
    updateRows = []

    const res = await app().request("/api/rag/sources/missing", { method: "DELETE" })
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(404)
    expect(body.code).toBe("source_not_found")
  })

  it("does not delete any documents when the source is not found or not owned", async () => {
    updateRows = []

    await app().request("/api/rag/sources/missing", { method: "DELETE" })

    expect(deleteCalls).toHaveLength(0)
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test --isolate apps/backend/src/routes/rag.test.ts`
Expected: FAIL — the new "hard-deletes the source's documents" test fails because `deleteCalls` is empty (the route doesn't call `db.delete` yet); the "does not delete any documents" test currently passes vacuously (no delete call exists anywhere yet) but will be a meaningful guard once Step 3 lands.

- [ ] **Step 3: Implement the minimal fix**

Replace the route (`apps/backend/src/routes/rag.ts:408-422`) with:

```ts
ragRouter.delete("/sources/:id", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const id = c.req.param("id")
  const [source] = await db
    .update(ragSources)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(ragSources.id, id), eq(ragSources.userId, user.id)))
    .returning({ id: ragSources.id })

  if (!source) return c.json({ error: "Source not found", code: "source_not_found" }, 404)

  // Hard-delete the source's documents so a later re-index into the same
  // (userId, path) slot can't resurrect them into visibility (#100) — rag_chunks
  // and rag_embeddings cascade-delete automatically via their FK onDelete rules.
  await db.delete(ragDocuments).where(eq(ragDocuments.sourceId, source.id))

  return c.json({ ok: true })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/routes/rag.test.ts`
Expected: PASS — all tests in the file, including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/rag.ts apps/backend/src/routes/rag.test.ts
git commit -m "fix(rag): hard-delete documents on source deletion (closes #100)"
```

---

### Task 2: `indexUploadedDocument` truncation-warning heuristic (closes #102, part 1)

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
  ): Promise<{ ok: true; documentId: string; warning?: string } | { error: string }>
  ```
  Task 3 does not consume this function directly (it lives in the backend, not agent-core), but Task 3's `IndexDocumentResult` type must match this success shape exactly (`{ ok: true; documentId: string; warning?: string }`).

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

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/services/rag/document-source.test.ts`, add two new tests inside the existing `describe("indexUploadedDocument", ...)` block, after the existing "indexes the document..." test:

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

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test --isolate apps/backend/src/services/rag/document-source.test.ts`
Expected: FAIL — `indexUploadedDocument` does not return a `warning` field yet, so the first new test fails; the second new test passes vacuously (no warning exists yet either way).

- [ ] **Step 3: Implement the minimal fix**

Replace `indexUploadedDocument` in `apps/backend/src/services/rag/document-source.ts` with:

```ts
const TRUNCATION_RISK_THRESHOLD_CHARS = 15_000
const TRUNCATION_RISK_WARNING =
  "This document may have been too large to index in full — the content indexed could be a partial capture of the original."

export async function indexUploadedDocument(
  userId: string,
  title: string,
  content: string,
): Promise<{ ok: true; documentId: string; warning?: string } | { error: string }> {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/rag/document-source.test.ts`
Expected: PASS — all tests in the file, including the 2 new ones. In particular, confirm every pre-existing test that asserts `toEqual({ ok: true, documentId: "doc-1" })` with short test content (well under 15,000 chars) still passes unchanged — the conditional spread means no `warning` key exists on that returned object at all, not merely an `undefined`-valued one.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/rag/document-source.ts apps/backend/src/services/rag/document-source.test.ts
git commit -m "fix(rag): flag possibly-truncated large documents (#102)"
```

---

### Task 3: `index_document` tool description + type update (closes #102, part 2)

**Files:**
- Modify: `packages/agent-core/src/index-document.ts`
- Modify: `packages/agent-core/src/index-document.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export type IndexDocumentResult =
    | { ok: true; documentId: string; warning?: string }
    | { error: string }
  ```
  This is the same shape Task 2's `indexUploadedDocument` already returns — this task updates the shared type declaration and the tool factory's pass-through behavior (which already passes the whole result through unchanged via `execute: async ({ title, content }) => indexDocument(title, content)`, so no logic change is needed here beyond the type and description).

The current file (`packages/agent-core/src/index-document.ts`) reads:

```ts
import { tool } from "ai"
import { z } from "zod"

export type IndexDocumentResult = { ok: true; documentId: string } | { error: string }
export type IndexDocumentFn = (title: string, content: string) => Promise<IndexDocumentResult>

export function createIndexDocumentTool(indexDocument: IndexDocumentFn) {
  return tool({
    description:
      "Index an uploaded document's content into the user's searchable cloud archive " +
      "so it can be found later by the deep_research tool. Use this when the user has " +
      "uploaded a PDF or Word document (its content will appear in your context as " +
      "'[Document: ...]') and asks you to remember, save, or index it.",
    parameters: z.object({
      title: z
        .string()
        .min(1)
        .max(200)
        .describe("A short, descriptive title — typically the document's filename"),
      content: z.string().min(1).max(100_000).describe("The document's extracted text content"),
    }),
    execute: async ({ title, content }) => indexDocument(title, content),
  })
}
```

- [ ] **Step 1: Write the failing test**

In `packages/agent-core/src/index-document.test.ts`, add a new test inside the existing `describe("createIndexDocumentTool", ...)` block, after the existing "calls the injected indexDocument callback..." test:

```ts
  it("passes a warning field through unchanged when present", async () => {
    const indexDocument: IndexDocumentFn = async () => ({
      ok: true,
      documentId: "doc-1",
      warning: "possibly truncated",
    })
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!({ title: "report.pdf", content: "text" }, {} as never)

    expect(result).toEqual({ ok: true, documentId: "doc-1", warning: "possibly truncated" })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --isolate packages/agent-core/src/index-document.test.ts`
Expected: FAIL — `IndexDocumentResult`'s type doesn't include `warning` yet, so this is a TypeScript compile error surfaced as a test failure (the mock's return value `{ ok: true, documentId: "doc-1", warning: "possibly truncated" }` doesn't satisfy the current `IndexDocumentResult` type).

- [ ] **Step 3: Implement the minimal fix**

Replace the type declaration and description in `packages/agent-core/src/index-document.ts`:

```ts
import { tool } from "ai"
import { z } from "zod"

export type IndexDocumentResult =
  | { ok: true; documentId: string; warning?: string }
  | { error: string }
export type IndexDocumentFn = (title: string, content: string) => Promise<IndexDocumentResult>

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
        .describe("A short, descriptive title — typically the document's filename"),
      content: z.string().min(1).max(100_000).describe("The document's extracted text content"),
    }),
    execute: async ({ title, content }) => indexDocument(title, content),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --isolate packages/agent-core/src/index-document.test.ts`
Expected: PASS — all tests in the file, including the new one.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/index-document.ts packages/agent-core/src/index-document.test.ts
git commit -m "fix(agent-core): warn on possibly-truncated large documents (#102)"
```

---

## Final Verification

- [ ] Run `bun run format` proactively before pushing, then re-verify tests still pass.
- [ ] Run `bun run lint`.
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate apps/backend/src/routes/rag.test.ts apps/backend/src/services/rag/document-source.test.ts packages/agent-core/src/index-document.test.ts` from repo root — all pass.
- [ ] Re-read `docs/superpowers/specs/2026-08-03-rag-backlog-fixes-design.md` and confirm both fixes (hard-delete ordering, truncation-warning threshold/shape) match exactly what's implemented.
- [ ] Close GitHub issues #100 and #102, referencing the PR that lands this plan.
