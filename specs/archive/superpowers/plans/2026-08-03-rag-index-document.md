# RAG index_document Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `index_document` tool the backend agent can call to persist an
uploaded PDF/Word document's already-extracted text into the user's cloud RAG
archive — same consent/plan gating as `index_text`/`index_url`, its own
"Uploaded documents" source bucket.

**Architecture:** A new agent-core file (`index-document.ts`) exporting a
`createIndexDocumentTool` factory, byte-for-byte the same shape as the existing
`index-text.ts`; a new backend service file (`document-source.ts`) mirroring
`manual-source.ts`'s shape, reusing the already-shared `ensureSource()` helper
with a new `"uploaded-documents"` bucket; wired into
`apps/backend/src/agent/run.ts`'s `extraTools` alongside
`index_text`/`index_url`, gated by the same `canUseRag` check. No new
extraction/fetch/OCR logic — `gateway-runner.ts`'s existing
`parseDocument`/`extractTextViaDrive` pipeline already turns an uploaded
PDF/Word file into text and injects it into the agent's context before this tool
is ever called.

**Tech Stack:** Bun, `ai` SDK's `tool()`/`zod`, Drizzle ORM, TypeScript,
`bun:test`.

## Global Constraints

- Spec: `specs/archive/superpowers/specs/2026-08-03-rag-index-document-design.md` — this
  plan implements it exactly; do not deviate without re-checking that file.
- **No new extraction logic.** `gateway-runner.ts`'s
  `parseDocument`/`document-extract.ts`'s `extractTextViaDrive` are reused
  entirely as-is, unmodified. This plan touches neither file.
- **Source keying:** one shared per-user `ragSources` row via
  `ensureSource(userId, { path: "uploaded-documents", name: "Uploaded documents", sourceType: "document" })`.
- **Document keying:** `externalId` is a fresh random UUID per call (same as
  `index_text`; unlike `index_url`, an uploaded document has no natural stable
  identity).
- **Title sanitization:** the filename-derived title must be run through the
  same `cleanTitle`-style sanitization already used by `index_text` (strip `\r`,
  collapse 3+ consecutive newlines to 2, slice to 200 chars, trim) before
  indexing — applied proactively here per the lesson from `index_url`'s final
  review (an unsanitized third-party title can break the passively-injected
  RAG-context header format).
- **Gating:** identical to `index_text`/`index_url` —
  `checkConsent(userId, "cloud_memory")` inside the service function (denial →
  `{ error }`); Pro/Max/owner plan check (`canUseRag`, already computed in
  `run.ts` — reused as-is, not recomputed) at tool-construction time (tool
  absent from `extraTools` entirely for Explore, not present-and-erroring).
- **Never throws:** `indexUploadedDocument` degrades to `{ error: string }` on
  every failure path (consent check exception, `indexDocument` exception,
  missing `documentId`), never throws — same pattern as
  `indexManualText`/`indexUrl`.
- **Schema comment update:** `packages/db/src/schema.ts:321`'s `sourceType`
  column comment currently reads `// "upload" | "url" | "folder" | "manual"` —
  must be updated to `// "upload" | "url" | "folder" | "manual" | "document"` as
  part of this plan (it is a documentation-only comment on a plain `text()`
  column, not an enforced enum — no migration needed).
- Conventional commit messages (`feat:`, `test:`, `refactor:`), lowercase, no
  full stop, max 72 chars, per `AGENTS.md`.
- Test commands, run from repo root:
  - `bun test --isolate packages/agent-core/src/index-document.test.ts` (Task 1)
  - `bun test --isolate apps/backend/src/services/rag/document-source.test.ts`
    (Task 2)
  - `bun test --isolate apps/backend/src/agent/run.test.ts` (Task 3)

---

## File Structure

- Create: `packages/agent-core/src/index-document.ts` —
  `createIndexDocumentTool` factory, `IndexDocumentResult`/`IndexDocumentFn`
  types.
- Create: `packages/agent-core/src/index-document.test.ts` — tests for the
  factory.
- Modify: `packages/agent-core/src/index.ts` — export the new symbols.
- Create: `apps/backend/src/services/rag/document-source.ts` —
  `ensureDocumentSource(userId)`,
  `indexUploadedDocument(userId, title, content)`.
- Create: `apps/backend/src/services/rag/document-source.test.ts` — tests for
  both functions.
- Modify: `apps/backend/src/agent/run.ts` — import `createIndexDocumentTool`,
  `indexUploadedDocument`; construct `indexDocumentTool` alongside
  `indexTextTool`/`indexUrlTool` (same `canUseRag` gate); add to `extraTools`.
- Modify: `apps/backend/src/agent/run.test.ts` — wiring tests proving
  `index_document` is present for a Pro-plan user and absent for an Explore-plan
  user.
- Modify: `packages/db/src/schema.ts` — update the `sourceType` column's
  type-hint comment to include `"document"`.

---

### Task 1: `createIndexDocumentTool` in agent-core

**Files:**

- Create: `packages/agent-core/src/index-document.ts`
- Create: `packages/agent-core/src/index-document.test.ts`

**Interfaces:**

- Consumes: `tool` from `ai`, `z` from `zod`.
- Produces:

  ```ts
  export type IndexDocumentResult =
    | { ok: true; documentId: string }
    | { error: string }
  export type IndexDocumentFn = (
    title: string,
    content: string,
  ) => Promise<IndexDocumentResult>
  export function createIndexDocumentTool(indexDocument: IndexDocumentFn)
  ```

  Task 3 consumes `createIndexDocumentTool` by this exact name (imported via
  `@yomi/agent-core` after Task 2 exports it).

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-core/src/index-document.test.ts` with this content:

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

  it("calls the injected indexDocument callback with title and content", async () => {
    let calledArgs: { title: string; content: string } | null = null
    const indexDocument: IndexDocumentFn = async (title, content) => {
      calledArgs = { title, content }
      return { ok: true, documentId: "doc-1" }
    }
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!(
      { title: "report.pdf", content: "extracted document text" },
      {} as never,
    )

    expect(calledArgs).toEqual({
      title: "report.pdf",
      content: "extracted document text",
    })
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  it("passes an error result through unchanged", async () => {
    const indexDocument: IndexDocumentFn = async () => ({
      error: "failed to index",
    })
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!(
      { title: "report.pdf", content: "text" },
      {} as never,
    )

    expect(result).toEqual({ error: "failed to index" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate packages/agent-core/src/index-document.test.ts`
Expected: FAIL — `index-document.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/agent-core/src/index-document.ts` with this content:

```ts
import { tool } from "ai"
import { z } from "zod"

export type IndexDocumentResult =
  | { ok: true; documentId: string }
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
      "'[Document: ...]') and asks you to remember, save, or index it.",
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate packages/agent-core/src/index-document.test.ts`
Expected: PASS — 3 tests, 0 fail.

- [ ] **Step 5: Export from agent-core's public API**

In `packages/agent-core/src/index.ts`, immediately after the existing line:

```ts
export {
  createIndexUrlTool,
  type IndexUrlResult,
  type IndexUrlFn,
} from "./index-url.js"
```

add:

```ts
export {
  createIndexDocumentTool,
  type IndexDocumentResult,
  type IndexDocumentFn,
} from "./index-document.js"
```

- [ ] **Step 6: Typecheck the package**

Run: `bun run typecheck` Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/index-document.ts packages/agent-core/src/index-document.test.ts packages/agent-core/src/index.ts
git commit -m "feat(agent-core): add index_document tool for cloud RAG"
```

---

### Task 2: `document-source.ts` backend service

**Files:**

- Create: `apps/backend/src/services/rag/document-source.ts`
- Create: `apps/backend/src/services/rag/document-source.test.ts`
- Modify: `packages/db/src/schema.ts:321`

**Interfaces:**

- Consumes: `ensureSource` from `./source-lookup.js` (existing, signature
  `ensureSource(userId: string, opts: { path: string; name: string; sourceType: string }): Promise<string>`);
  `indexDocument` from `./index-document.js` (existing, the shared RAG
  chunk/embed helper — a different file from Task 1's agent-core
  `index-document.ts`, despite the similar name: this one lives at
  `apps/backend/src/services/rag/index-document.ts` and is the same function
  `manual-source.ts`/`url-ingest.ts` already call); `checkConsent` from
  `../privacy/checks.js` (existing).
- Produces:

  ```ts
  export const DOCUMENT_SOURCE_TYPE = "document"
  export async function ensureDocumentSource(userId: string): Promise<string>
  export async function indexUploadedDocument(
    userId: string,
    title: string,
    content: string,
  ): Promise<{ ok: true; documentId: string } | { error: string }>
  ```

  Task 3 consumes `indexUploadedDocument` by this exact name and signature,
  imported from `../services/rag/document-source.js`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/services/rag/document-source.test.ts` with this
content:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let ensureSourceCalls: { userId: string; opts: Record<string, unknown> }[] = []
let ensureSourceResult = "source-1"
mock.module("./source-lookup.js", () => ({
  ensureSource: async (userId: string, opts: Record<string, unknown>) => {
    ensureSourceCalls.push({ userId, opts })
    return ensureSourceResult
  },
}))

let consentAllowed = true
let consentReason: string | null = "not granted"
let consentShouldThrow = false
mock.module("../privacy/checks.js", () => ({
  checkConsent: async () => {
    if (consentShouldThrow) throw new Error("db connection blip")
    return { allowed: consentAllowed, reason: consentReason }
  },
}))

let indexDocumentResult: {
  status: "indexed" | "unchanged"
  documentId: string | null
} = {
  status: "indexed",
  documentId: "doc-1",
}
let indexDocumentShouldThrow = false
let indexDocumentCalls: Record<string, unknown>[] = []
mock.module("./index-document.js", () => ({
  indexDocument: async (input: Record<string, unknown>) => {
    indexDocumentCalls.push(input)
    if (indexDocumentShouldThrow) throw new Error("db write failed")
    return indexDocumentResult
  },
}))

const { DOCUMENT_SOURCE_TYPE, ensureDocumentSource, indexUploadedDocument } =
  await import("./document-source.js")

beforeEach(() => {
  ensureSourceCalls = []
  ensureSourceResult = "source-1"
  consentAllowed = true
  consentReason = "not granted"
  consentShouldThrow = false
  indexDocumentResult = { status: "indexed", documentId: "doc-1" }
  indexDocumentShouldThrow = false
  indexDocumentCalls = []
})

describe("ensureDocumentSource", () => {
  it("calls ensureSource with the fixed Uploaded documents params", async () => {
    const id = await ensureDocumentSource("u1")
    expect(id).toBe("source-1")
    expect(ensureSourceCalls).toHaveLength(1)
    expect(ensureSourceCalls[0]!.userId).toBe("u1")
    expect(ensureSourceCalls[0]!.opts).toEqual({
      path: "uploaded-documents",
      name: "Uploaded documents",
      sourceType: DOCUMENT_SOURCE_TYPE,
    })
  })
})

describe("indexUploadedDocument", () => {
  it("returns an error and does not call indexDocument when consent is denied", async () => {
    consentAllowed = false

    const result = await indexUploadedDocument(
      "u1",
      "report.pdf",
      "extracted text",
    )

    expect(result).toEqual({
      error: "cloud memory consent not granted: not granted",
    })
    expect(indexDocumentCalls).toHaveLength(0)
  })

  it("indexes the document under the document source with a fresh externalId", async () => {
    const result = await indexUploadedDocument(
      "u1",
      "report.pdf",
      "extracted text",
    )

    expect(result).toEqual({ ok: true, documentId: "doc-1" })
    expect(indexDocumentCalls).toHaveLength(1)
    const call = indexDocumentCalls[0]!
    expect(call["userId"]).toBe("u1")
    expect(call["title"]).toBe("report.pdf")
    expect(call["text"]).toBe("extracted text")
    expect(call["mimeType"]).toBe("text/plain")
    expect(typeof call["externalId"]).toBe("string")
    expect((call["externalId"] as string).length).toBeGreaterThan(10)
  })

  it("uses a distinct externalId on each call, so repeated uploads never overwrite", async () => {
    await indexUploadedDocument("u1", "report.pdf", "first version")
    await indexUploadedDocument("u1", "report.pdf", "second version")

    expect(indexDocumentCalls).toHaveLength(2)
    expect(indexDocumentCalls[0]!["externalId"]).not.toBe(
      indexDocumentCalls[1]!["externalId"],
    )
  })

  it("sanitizes the title before indexing", async () => {
    const result = await indexUploadedDocument(
      "u1",
      "weird\r\n\n\n\ntitle.pdf",
      "extracted text",
    )

    expect(result).toEqual({ ok: true, documentId: "doc-1" })
    expect(indexDocumentCalls[0]!["title"]).toBe("weird\n\ntitle.pdf")
  })

  it("returns an error when indexDocument returns no documentId", async () => {
    indexDocumentResult = { status: "unchanged", documentId: null }

    const result = await indexUploadedDocument(
      "u1",
      "report.pdf",
      "extracted text",
    )

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when indexDocument rejects", async () => {
    indexDocumentShouldThrow = true

    const result = await indexUploadedDocument(
      "u1",
      "report.pdf",
      "extracted text",
    )

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when checkConsent rejects", async () => {
    consentShouldThrow = true

    const result = await indexUploadedDocument(
      "u1",
      "report.pdf",
      "extracted text",
    )

    expect(result).toEqual({ error: "failed to index" })
    expect(indexDocumentCalls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/services/rag/document-source.test.ts`
Expected: FAIL — `document-source.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/backend/src/services/rag/document-source.ts` with this content:

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

- [ ] **Step 5: Update the schema comment**

In `packages/db/src/schema.ts`, find this line (line 321):

```ts
    sourceType: text("source_type").notNull(), // "upload" | "url" | "folder" | "manual"
```

Change it to:

```ts
    sourceType: text("source_type").notNull(), // "upload" | "url" | "folder" | "manual" | "document"
```

This is a documentation-only comment on a plain `text()` column — no migration
is needed, no enum is enforced at the database level.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck` Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/rag/document-source.ts apps/backend/src/services/rag/document-source.test.ts packages/db/src/schema.ts
git commit -m "feat(rag): add document-source service for uploaded documents"
```

---

### Task 3: Wire `index_document` into the backend agent

**Files:**

- Modify: `apps/backend/src/agent/run.ts` — import block (lines 4-22, 42-43),
  `canUseRag` gate block (lines 576-587), `extraTools` object (lines 589-601)
- Modify: `apps/backend/src/agent/run.test.ts`

**Interfaces:**

- Consumes: `createIndexDocumentTool` from `@yomi/agent-core` (Task 1);
  `indexUploadedDocument` from `../services/rag/document-source.js` (Task 2).
  The existing in-scope `canUseRag` boolean (already computed for
  `index_text`/`index_url`'s gate at `run.ts:580-583` — reused as-is, not
  recomputed).
- Produces: nothing new for later tasks — this is the final integration point
  for this plan.

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/agent/run.test.ts`, find the existing `index_url` wiring
tests (currently at lines 334-353):

```ts
it("wires an index_url tool into extraTools for a Pro-plan user", async () => {
  mockUser = makeUser({ plan: "pro" })
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  const indexUrlTool = lastAgentExtraTools!["index_url"] as {
    execute?: unknown
    description?: string
  }
  expect(typeof indexUrlTool.execute).toBe("function")
  expect(indexUrlTool.description).toContain("URL")
})

it("omits index_url from extraTools for an Explore-plan user", async () => {
  mockUser = makeUser({ plan: "explore" })
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  expect(lastAgentExtraTools!["index_url"]).toBeUndefined()
})
```

Add two new tests immediately after them:

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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test --isolate apps/backend/src/agent/run.test.ts -t "index_document"`
Expected: FAIL — `lastAgentExtraTools!["index_document"]` is `undefined` in the
first new test (the wiring doesn't exist yet).

- [ ] **Step 3: Add the imports**

In `apps/backend/src/agent/run.ts`, the `@yomi/agent-core` import block
currently reads:

```ts
import {
  ConnectorRegistry,
  createDeepResearchTool,
  createDelegateTool,
  createIndexTextTool,
  createIndexUrlTool,
  createModel,
  createReactionTool,
  createRecallTool,
  createWebSearchTool,
  formatConnectorIdCatalog,
  formatIntegrationSuggestions,
  runAgentLoop,
  searchWeb,
  suggestIntegrationsFor,
  type AgentMessage,
  type ReactFn,
  type UsageInfo,
} from "@yomi/agent-core"
```

Change it to (adding `createIndexDocumentTool` in alphabetical position):

```ts
import {
  ConnectorRegistry,
  createDeepResearchTool,
  createDelegateTool,
  createIndexDocumentTool,
  createIndexTextTool,
  createIndexUrlTool,
  createModel,
  createReactionTool,
  createRecallTool,
  createWebSearchTool,
  formatConnectorIdCatalog,
  formatIntegrationSuggestions,
  runAgentLoop,
  searchWeb,
  suggestIntegrationsFor,
  type AgentMessage,
  type ReactFn,
  type UsageInfo,
} from "@yomi/agent-core"
```

Find this line:

```ts
import { indexUrl } from "../services/rag/url-ingest.js"
```

Add a new import immediately after it:

```ts
import { indexUrl } from "../services/rag/url-ingest.js"
import { indexUploadedDocument } from "../services/rag/document-source.js"
```

- [ ] **Step 4: Construct the tool and add it to `extraTools`**

Find this block:

```ts
  // Cloud RAG is a paid-plan feature at the REST layer (ragAllowed() in routes/rag.ts) —
  // index_text/index_url must not be a side door around that for an Explore user. Rather
  // than add the tools and have them always error for Explore, they're simply absent
  // from extraTools.
  const canUseRag =
    isOwnerUser(user) ||
    effectivePlanForUser(user) === "pro" ||
    effectivePlanForUser(user) === "max"
  const indexTextTool = canUseRag
    ? createIndexTextTool((title, content) => indexManualText(opts.userId, title, content))
    : null
  const indexUrlTool = canUseRag ? createIndexUrlTool((url) => indexUrl(opts.userId, url)) : null
  try {
    text = await runAgentLoop({
      registry,
      text: opts.text,
      history,
      extraTools: {
        recall_past_conversations: recallTool,
        web_search: webSearchTool,
        delegate: delegateTool,
        deep_research: deepResearchTool,
        ...(indexTextTool ? { index_text: indexTextTool } : {}),
        ...(indexUrlTool ? { index_url: indexUrlTool } : {}),
        ...(reactionTool ? { react_to_message: reactionTool } : {}),
      },
```

Change it to:

```ts
  // Cloud RAG is a paid-plan feature at the REST layer (ragAllowed() in routes/rag.ts) —
  // index_text/index_url/index_document must not be a side door around that for an
  // Explore user. Rather than add the tools and have them always error for Explore,
  // they're simply absent from extraTools.
  const canUseRag =
    isOwnerUser(user) ||
    effectivePlanForUser(user) === "pro" ||
    effectivePlanForUser(user) === "max"
  const indexTextTool = canUseRag
    ? createIndexTextTool((title, content) => indexManualText(opts.userId, title, content))
    : null
  const indexUrlTool = canUseRag ? createIndexUrlTool((url) => indexUrl(opts.userId, url)) : null
  const indexDocumentTool = canUseRag
    ? createIndexDocumentTool((title, content) =>
        indexUploadedDocument(opts.userId, title, content),
      )
    : null
  try {
    text = await runAgentLoop({
      registry,
      text: opts.text,
      history,
      extraTools: {
        recall_past_conversations: recallTool,
        web_search: webSearchTool,
        delegate: delegateTool,
        deep_research: deepResearchTool,
        ...(indexTextTool ? { index_text: indexTextTool } : {}),
        ...(indexUrlTool ? { index_url: indexUrlTool } : {}),
        ...(indexDocumentTool ? { index_document: indexDocumentTool } : {}),
        ...(reactionTool ? { react_to_message: reactionTool } : {}),
      },
```

- [ ] **Step 5: Run the full test file to verify everything passes**

Run: `bun test --isolate apps/backend/src/agent/run.test.ts` Expected: PASS —
all existing tests plus the two new ones.

- [ ] **Step 6: Typecheck and run the full backend + agent-core suites**

Run: `bun run typecheck` Expected: 0 errors.

Run: `bun test --isolate apps/backend/src` Expected: all pass.

Run: `bun test --isolate packages/agent-core/src` Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/agent/run.ts apps/backend/src/agent/run.test.ts
git commit -m "feat(agent): wire index_document tool into the backend agent"
```

---

## Final Verification

- [ ] Run `bun run format` proactively before pushing, then re-verify tests
      still pass.
- [ ] Run `bun run lint`.
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate packages/agent-core/src` from repo root — all
      pass.
- [ ] Run `bun test --isolate apps/backend/src` from repo root — all pass.
- [ ] Re-read `specs/archive/superpowers/specs/2026-08-03-rag-index-document-design.md`
      and confirm every section (interface, source/document keying, title
      handling, gating, backend service, wiring, error handling) has a
      corresponding implemented piece.
