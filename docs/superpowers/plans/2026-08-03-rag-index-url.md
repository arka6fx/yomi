# RAG index_url Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `index_url` tool the backend agent can call to fetch a URL,
extract its readable text, and index it into the user's cloud RAG archive —
SSRF-safe, gated by the same consent/plan checks as `index_text`.

**Architecture:** Extract `manual-source.ts`'s hardened get-or-create logic into
a shared `source-lookup.ts` (used by both `index_text` and this new tool); a new
agent-core file (`index-url.ts`) exporting a `createIndexUrlTool` factory (same
shape as `index-text.ts`); a new backend service file (`url-ingest.ts`) doing
the SSRF-gated fetch, bounds checks, and HTML extraction, then reusing
`indexDocument()` exactly like `index_text` does; wired into
`apps/backend/src/agent/run.ts`'s `extraTools` alongside `index_text`, gated by
the same plan check.

**Tech Stack:** Bun, `ai` SDK's `tool()`/`zod`, Drizzle ORM, TypeScript,
`bun:test`, native `fetch`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-rag-index-url-design.md` — this plan
  implements it exactly; do not deviate without re-checking that file.
- **SSRF:** every `http`/`https` URL's hostname is checked via
  `resolvesToDisallowedAddress` (from `@yomi/agent-core`, already used by
  `registry.ts` for custom MCP servers) before any fetch. Non-`http`/`https`
  schemes are rejected before that check even runs. The fetch itself uses
  `redirect: "manual"`; any 3xx response is a hard failure — no redirect is ever
  followed.
- **Fetch bounds:** `AbortSignal.timeout(10_000)`. `Content-Length` header
  checked before buffering (reject over 2,000,000 bytes without downloading).
  Actual buffered body length checked as a backstop (reject over 2,000,000
  bytes). `Content-Type` must start with `text/html` or `text/plain` — anything
  else is rejected.
- **Extraction:** regex-based, same approach as `gateway-runner.ts`'s
  `parseDocument` — strip `<title>`/`<style>`/`<script>` content (title is
  stripped from the body text because it's extracted separately, below), strip
  remaining tags, collapse whitespace. `text/plain` used as-is. Title from
  `<title>...</title>` (regex `/<title[^>]*>([^<]*)<\/title>/i`), falling back
  to the URL itself when absent or for plain-text.
- **Document keying — differs from `index_text`:** `externalId` is the
  normalized URL (fragment stripped), not a random UUID — re-indexing the same
  URL updates the existing document via `indexDocument()`'s content-hash check,
  rather than creating a duplicate.
- **Source keying:** one shared per-user `ragSources` row via
  `ensureSource(userId, { path: "indexed-urls", name: "Indexed URLs", sourceType: "url" })`.
- **Gating:** identical to `index_text` — `checkConsent(userId, "cloud_memory")`
  inside the service function (before any fetch); Pro/Max/owner plan check at
  tool-construction time in `run.ts` (tool absent from `extraTools`, not
  present-and-erroring, for Explore).
- **Never throws:** both `fetchAndExtractUrl` and `indexUrl` degrade to
  `{ error: string }` on every failure path, including unexpected exceptions —
  `indexUrl` wraps its whole body in try/catch and `console.error`s before
  returning, same pattern `indexManualText` uses.
- **Exact error strings** `fetchAndExtractUrl` must return, one per case:
  - Non-`http`/`https` scheme or unparseable URL:
    `"only http and https URLs can be indexed"`
  - SSRF-blocked hostname: `"that URL cannot be fetched"`
  - Redirect response (any 3xx):
    `"that URL redirects, which isn't supported yet"`
  - Fetch throws (timeout/network): `"failed to fetch that URL"`
  - Non-2xx response: `` `fetch failed with status ${response.status}` ``
  - Wrong content-type: `"only HTML and plain-text pages can be indexed"`
  - Oversized (`Content-Length` header or actual buffered body over 2,000,000
    bytes): `"that page is too large to index"`
- Conventional commit messages (`feat:`, `test:`, `refactor:`), lowercase, no
  full stop, max 72 chars, per `AGENTS.md`.
- Test commands, run from repo root:
  - `bun test --isolate packages/agent-core/src/index-url.test.ts` (Task 2)
  - `bun test --isolate apps/backend/src/services/rag/source-lookup.test.ts`
    (Task 1)
  - `bun test --isolate apps/backend/src/services/rag/manual-source.test.ts`
    (Task 1)
  - `bun test --isolate apps/backend/src/services/rag/url-ingest.test.ts`
    (Task 4)
  - `bun test --isolate apps/backend/src/agent/run.test.ts` (Task 5)

---

## File Structure

- Create: `apps/backend/src/services/rag/source-lookup.ts` —
  `ensureSource(userId, { path, name, sourceType })`, extracted and generalized
  from `manual-source.ts`.
- Create: `apps/backend/src/services/rag/source-lookup.test.ts` — the hardened
  get-or-create test coverage, moved from `manual-source.test.ts` and
  generalized.
- Modify: `apps/backend/src/services/rag/manual-source.ts` —
  `ensureManualSource` becomes a thin wrapper around `ensureSource`;
  `indexManualText` unchanged.
- Modify: `apps/backend/src/services/rag/manual-source.test.ts` — shrinks:
  `ensureManualSource` becomes one pass-through test (mocking
  `./source-lookup.js`); `indexManualText`'s 6 existing tests unchanged.
- Create: `packages/agent-core/src/index-url.ts` — `createIndexUrlTool` factory,
  `IndexUrlResult`/`IndexUrlFn` types.
- Create: `packages/agent-core/src/index-url.test.ts` — tests for the factory.
- Modify: `packages/agent-core/src/index.ts` — export the new symbols.
- Create: `apps/backend/src/services/rag/url-ingest.ts` —
  `fetchAndExtractUrl(url)`, `indexUrl(userId, url)`.
- Create: `apps/backend/src/services/rag/url-ingest.test.ts` — tests for both
  functions.
- Modify: `apps/backend/src/agent/run.ts` — import `createIndexUrlTool`,
  `indexUrl`; construct `indexUrlTool` alongside `indexTextTool` (same
  `canUseRag` gate); add to `extraTools`.
- Modify: `apps/backend/src/agent/run.test.ts` — wiring tests proving
  `index_url` is present for a Pro-plan user and absent for an Explore-plan
  user.

---

### Task 1: Extract `ensureSource` into `source-lookup.ts`

**Files:**

- Create: `apps/backend/src/services/rag/source-lookup.ts`
- Create: `apps/backend/src/services/rag/source-lookup.test.ts`
- Modify: `apps/backend/src/services/rag/manual-source.ts`
- Modify: `apps/backend/src/services/rag/manual-source.test.ts`

**Interfaces:**

- Consumes: `db`, `ragSources` from `@yomi/db`; `and`, `eq`, `ne` from
  `drizzle-orm` (moving from `manual-source.ts`, which currently imports these
  directly).
- Produces:
  ```ts
  export interface EnsureSourceOptions {
    path: string
    name: string
    sourceType: string
  }
  export async function ensureSource(
    userId: string,
    opts: EnsureSourceOptions,
  ): Promise<string>
  ```
  Task 4 consumes `ensureSource` by this exact name and signature, imported from
  `./source-lookup.js`.

This is a pure refactor — no behavior change to `index_text`. The current
`apps/backend/src/services/rag/manual-source.ts` reads:

```ts
import { and, eq, ne } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"

export const MANUAL_SOURCE_TYPE = "manual"
const MANUAL_SOURCE_NAME = "Chat notes"
const MANUAL_SOURCE_PATH = "chat-notes"

function cleanTitle(value: string, max: number): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

// Idempotent get-or-create: every index_text call for a user reuses the same
// "Chat notes" source rather than creating a new one each time.
export async function ensureManualSource(userId: string): Promise<string> {
  const existing = await db
    .select({ id: ragSources.id })
    .from(ragSources)
    .where(
      and(
        eq(ragSources.userId, userId),
        eq(ragSources.path, MANUAL_SOURCE_PATH),
        ne(ragSources.status, "deleted"),
      ),
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(ragSources)
    .values({
      userId,
      name: MANUAL_SOURCE_NAME,
      path: MANUAL_SOURCE_PATH,
      sourceType: MANUAL_SOURCE_TYPE,
      status: "ready",
    })
    .onConflictDoNothing({ target: [ragSources.userId, ragSources.path] })
    .returning()
  if (created) return created.id

  // Lost the insert race, or the (userId, path) slot is occupied by a row this
  // user soft-deleted earlier (DELETE /rag/sources/:id doesn't free the path).
  // Re-select without the status filter to find whichever row holds the slot,
  // then resurrect it if it's the deleted one — the alternative (leaving it dead
  // and permanently failing to create a fresh "Chat notes" source) is worse.
  const [row] = await db
    .select({ id: ragSources.id, status: ragSources.status })
    .from(ragSources)
    .where(
      and(
        eq(ragSources.userId, userId),
        eq(ragSources.path, MANUAL_SOURCE_PATH),
      ),
    )
    .limit(1)
  if (!row) throw new Error("failed to create or find manual source")
  if (row.status === "deleted") {
    await db
      .update(ragSources)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(ragSources.id, row.id))
  }
  return row.id
}

// Consent-gated wrapper around indexDocument() for agent-triggered text pastes. Never
// throws — a thrown error from checkConsent, ensureManualSource, or indexDocument would
// otherwise propagate out of the index_text tool's execute and kill the whole parent
// turn (same class of bug fixed for delegate/deep_research after item 6/5's final
// reviews), so the whole body — including the consent check — is guarded.
export async function indexManualText(
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

    const sourceId = await ensureManualSource(userId)
    const result = await indexDocument({
      userId,
      sourceId,
      externalId: crypto.randomUUID(),
      title: cleanTitle(title, 200),
      mimeType: "text/plain",
      text: content,
    })
    // Only errors on a missing documentId — with a fresh externalId per call, indexDocument's
    // "unchanged" status is unreachable here, so checking for it (as an earlier draft of the
    // design spec suggested) would be dead code.
    if (!result.documentId) return { error: "failed to index" }
    return { ok: true, documentId: result.documentId }
  } catch (err) {
    console.error(
      "[indexManualText] failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return { error: "failed to index" }
  }
}
```

- [ ] **Step 1: Create `source-lookup.ts`**

Create `apps/backend/src/services/rag/source-lookup.ts` with this content (the
`ensureManualSource` body above, generalized to take `path`/`name`/`sourceType`
as parameters):

```ts
import { and, eq, ne } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"

export interface EnsureSourceOptions {
  path: string
  name: string
  sourceType: string
}

// Idempotent get-or-create, path-keyed and race-safe via the (userId, path) unique
// constraint. Resurrects a soft-deleted row rather than leaving it permanently dead
// and re-insert-blocked — DELETE /rag/sources/:id doesn't free the path.
export async function ensureSource(
  userId: string,
  opts: EnsureSourceOptions,
): Promise<string> {
  const existing = await db
    .select({ id: ragSources.id })
    .from(ragSources)
    .where(
      and(
        eq(ragSources.userId, userId),
        eq(ragSources.path, opts.path),
        ne(ragSources.status, "deleted"),
      ),
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(ragSources)
    .values({
      userId,
      name: opts.name,
      path: opts.path,
      sourceType: opts.sourceType,
      status: "ready",
    })
    .onConflictDoNothing({ target: [ragSources.userId, ragSources.path] })
    .returning()
  if (created) return created.id

  // Lost the insert race, or the (userId, path) slot is occupied by a row this
  // user soft-deleted earlier (DELETE /rag/sources/:id doesn't free the path).
  // Re-select without the status filter to find whichever row holds the slot,
  // then resurrect it if it's the deleted one — the alternative (leaving it dead
  // and permanently failing to create a fresh source) is worse.
  const [row] = await db
    .select({ id: ragSources.id, status: ragSources.status })
    .from(ragSources)
    .where(and(eq(ragSources.userId, userId), eq(ragSources.path, opts.path)))
    .limit(1)
  if (!row) throw new Error("failed to create or find source")
  if (row.status === "deleted") {
    await db
      .update(ragSources)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(ragSources.id, row.id))
  }
  return row.id
}
```

- [ ] **Step 2: Create `source-lookup.test.ts`**

Create `apps/backend/src/services/rag/source-lookup.test.ts` with this content
(the get-or-create test coverage moved from `manual-source.test.ts`,
generalized):

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectRows: { id: string; status?: string }[] = []
let fallbackSelectRows: { id: string; status?: string }[] = []
let selectCallCount = 0
let insertedSources: Record<string, unknown>[] = []
let nextSourceId = 1
let insertConflicts = false
let updateCalls: Record<string, unknown>[] = []

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            selectCallCount++
            return Promise.resolve(
              selectCallCount === 1 ? selectRows : fallbackSelectRows,
            )
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (insertConflicts) return Promise.resolve([])
            const id = `source-${nextSourceId++}`
            insertedSources.push({ id, ...v })
            return Promise.resolve([{ id, ...v }])
          },
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push(v)
          return Promise.resolve()
        },
      }),
    }),
  },
  ragSources: { __name: "rag_sources" },
}))

const { ensureSource } = await import("./source-lookup.js")

const manualOpts = {
  path: "chat-notes",
  name: "Chat notes",
  sourceType: "manual",
}

beforeEach(() => {
  selectRows = []
  fallbackSelectRows = []
  selectCallCount = 0
  insertedSources = []
  nextSourceId = 1
  insertConflicts = false
  updateCalls = []
})

describe("ensureSource", () => {
  it("creates a source on first call", async () => {
    const id = await ensureSource("u1", manualOpts)
    expect(id).toBe("source-1")
    expect(insertedSources).toHaveLength(1)
    expect(insertedSources[0]!["sourceType"]).toBe("manual")
    expect(insertedSources[0]!["userId"]).toBe("u1")
  })

  it("reuses the existing source on a later call", async () => {
    selectRows = [{ id: "existing-source" }]
    const id = await ensureSource("u1", manualOpts)
    expect(id).toBe("existing-source")
    expect(insertedSources).toHaveLength(0)
  })

  it("does not reuse a soft-deleted source", async () => {
    selectRows = []
    const id = await ensureSource("u1", manualOpts)
    expect(id).toBe("source-1")
    expect(id).not.toBe("existing-deleted-source")
    expect(insertedSources).toHaveLength(1)
    expect(insertedSources[0]!["path"]).toBe("chat-notes")
  })

  it("resurrects a soft-deleted source when the insert conflicts on a deleted row's slot", async () => {
    selectRows = []
    fallbackSelectRows = [{ id: "deleted-source", status: "deleted" }]
    insertConflicts = true

    const id = await ensureSource("u1", manualOpts)

    expect(id).toBe("deleted-source")
    expect(insertedSources).toHaveLength(0)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!["status"]).toBe("ready")
    expect(updateCalls[0]!["updatedAt"]).toBeInstanceOf(Date)
  })

  it("works with a different path/name/sourceType for a different bucket", async () => {
    const urlOpts = {
      path: "indexed-urls",
      name: "Indexed URLs",
      sourceType: "url",
    }
    await ensureSource("u1", urlOpts)
    expect(insertedSources[0]!["path"]).toBe("indexed-urls")
    expect(insertedSources[0]!["name"]).toBe("Indexed URLs")
    expect(insertedSources[0]!["sourceType"]).toBe("url")
  })
})
```

- [ ] **Step 3: Run the new test file to verify it passes**

Run: `bun test --isolate apps/backend/src/services/rag/source-lookup.test.ts`
Expected: PASS — 5 tests, 0 fail.

- [ ] **Step 4: Shrink `manual-source.ts` to use `ensureSource`**

Replace the full content of `apps/backend/src/services/rag/manual-source.ts`
with:

```ts
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"
import { ensureSource } from "./source-lookup.js"

export const MANUAL_SOURCE_TYPE = "manual"
const MANUAL_SOURCE_NAME = "Chat notes"
const MANUAL_SOURCE_PATH = "chat-notes"

function cleanTitle(value: string, max: number): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

// Idempotent get-or-create: every index_text call for a user reuses the same
// "Chat notes" source rather than creating a new one each time.
export async function ensureManualSource(userId: string): Promise<string> {
  return ensureSource(userId, {
    path: MANUAL_SOURCE_PATH,
    name: MANUAL_SOURCE_NAME,
    sourceType: MANUAL_SOURCE_TYPE,
  })
}

// Consent-gated wrapper around indexDocument() for agent-triggered text pastes. Never
// throws — a thrown error from checkConsent, ensureManualSource, or indexDocument would
// otherwise propagate out of the index_text tool's execute and kill the whole parent
// turn (same class of bug fixed for delegate/deep_research after item 6/5's final
// reviews), so the whole body — including the consent check — is guarded.
export async function indexManualText(
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

    const sourceId = await ensureManualSource(userId)
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
      "[indexManualText] failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return { error: "failed to index" }
  }
}
```

- [ ] **Step 5: Shrink `manual-source.test.ts`**

Replace the full content of
`apps/backend/src/services/rag/manual-source.test.ts` with:

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

const { MANUAL_SOURCE_TYPE, ensureManualSource, indexManualText } =
  await import("./manual-source.js")

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

describe("ensureManualSource", () => {
  it("calls ensureSource with the fixed Chat notes params", async () => {
    const id = await ensureManualSource("u1")
    expect(id).toBe("source-1")
    expect(ensureSourceCalls).toHaveLength(1)
    expect(ensureSourceCalls[0]!.userId).toBe("u1")
    expect(ensureSourceCalls[0]!.opts).toEqual({
      path: "chat-notes",
      name: "Chat notes",
      sourceType: MANUAL_SOURCE_TYPE,
    })
  })
})

describe("indexManualText", () => {
  it("returns an error and does not call indexDocument when consent is denied", async () => {
    consentAllowed = false

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({
      error: "cloud memory consent not granted: not granted",
    })
    expect(indexDocumentCalls).toHaveLength(0)
  })

  it("indexes the text under the manual source with a fresh externalId", async () => {
    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ ok: true, documentId: "doc-1" })
    expect(indexDocumentCalls).toHaveLength(1)
    const call = indexDocumentCalls[0]!
    expect(call["userId"]).toBe("u1")
    expect(call["title"]).toBe("Notes")
    expect(call["text"]).toBe("some content")
    expect(call["mimeType"]).toBe("text/plain")
    expect(typeof call["externalId"]).toBe("string")
    expect((call["externalId"] as string).length).toBeGreaterThan(10)
  })

  it("uses a distinct externalId on each call, so repeated pastes never overwrite", async () => {
    await indexManualText("u1", "Notes", "first paste")
    await indexManualText("u1", "Notes", "second paste")

    expect(indexDocumentCalls).toHaveLength(2)
    expect(indexDocumentCalls[0]!["externalId"]).not.toBe(
      indexDocumentCalls[1]!["externalId"],
    )
  })

  it("returns an error when indexDocument returns no documentId", async () => {
    indexDocumentResult = { status: "unchanged", documentId: null }

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when indexDocument rejects", async () => {
    indexDocumentShouldThrow = true

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when checkConsent rejects", async () => {
    consentShouldThrow = true

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "failed to index" })
    expect(indexDocumentCalls).toHaveLength(0)
  })
})
```

- [ ] **Step 6: Run both test files to verify everything passes**

Run:
`bun test --isolate apps/backend/src/services/rag/source-lookup.test.ts apps/backend/src/services/rag/manual-source.test.ts`
Expected: PASS — 5 + 7 = 12 tests, 0 fail.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck` Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/services/rag/source-lookup.ts apps/backend/src/services/rag/source-lookup.test.ts apps/backend/src/services/rag/manual-source.ts apps/backend/src/services/rag/manual-source.test.ts
git commit -m "refactor(rag): extract ensureSource for reuse across ingestion tools"
```

---

### Task 2: `createIndexUrlTool` in agent-core

**Files:**

- Create: `packages/agent-core/src/index-url.ts`
- Create: `packages/agent-core/src/index-url.test.ts`

**Interfaces:**

- Consumes: `tool` from `ai`, `z` from `zod`.
- Produces:

  ```ts
  export type IndexUrlResult =
    | { ok: true; documentId: string; title: string }
    | { error: string }
  export type IndexUrlFn = (url: string) => Promise<IndexUrlResult>
  export function createIndexUrlTool(indexUrl: IndexUrlFn)
  ```

  Task 5 consumes `createIndexUrlTool` by this exact name (imported via
  `@yomi/agent-core` after Task 3 exports it). This task does not depend on
  Task 1.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-core/src/index-url.test.ts` with this content:

```ts
import { describe, expect, it } from "bun:test"
import { createIndexUrlTool, type IndexUrlFn } from "./index-url.js"

describe("createIndexUrlTool", () => {
  it("returns a tool with the correct shape", () => {
    const indexUrl: IndexUrlFn = async () => ({
      ok: true,
      documentId: "doc-1",
      title: "Article",
    })
    const t = createIndexUrlTool(indexUrl)
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("URL")
    expect(t.parameters).toBeDefined()
  })

  it("calls the injected indexUrl callback with the url", async () => {
    let calledUrl: string | null = null
    const indexUrl: IndexUrlFn = async (url) => {
      calledUrl = url
      return { ok: true, documentId: "doc-1", title: "Article" }
    }
    const t = createIndexUrlTool(indexUrl)

    const result = await t.execute!(
      { url: "https://example.com/article" },
      {} as never,
    )

    expect(calledUrl).toBe("https://example.com/article")
    expect(result).toEqual({ ok: true, documentId: "doc-1", title: "Article" })
  })

  it("passes an error result through unchanged", async () => {
    const indexUrl: IndexUrlFn = async () => ({
      error: "that URL cannot be fetched",
    })
    const t = createIndexUrlTool(indexUrl)

    const result = await t.execute!({ url: "https://example.com" }, {} as never)

    expect(result).toEqual({ error: "that URL cannot be fetched" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate packages/agent-core/src/index-url.test.ts` Expected:
FAIL — `index-url.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/agent-core/src/index-url.ts` with this content:

```ts
import { tool } from "ai"
import { z } from "zod"

export type IndexUrlResult =
  | { ok: true; documentId: string; title: string }
  | { error: string }
export type IndexUrlFn = (url: string) => Promise<IndexUrlResult>

export function createIndexUrlTool(indexUrl: IndexUrlFn) {
  return tool({
    description:
      "Fetch a URL and index its readable content into the user's searchable cloud " +
      "archive so it can be found later by the deep_research tool. Use this when the " +
      "user shares a link and asks you to remember, save, or index it.",
    parameters: z.object({
      url: z.string().url().max(2000).describe("The URL to fetch and index"),
    }),
    execute: async ({ url }) => indexUrl(url),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate packages/agent-core/src/index-url.test.ts` Expected:
PASS — 3 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/index-url.ts packages/agent-core/src/index-url.test.ts
git commit -m "feat(agent-core): add index_url tool for cloud RAG"
```

---

### Task 3: Export from agent-core's public API

**Files:**

- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**

- Consumes: `createIndexUrlTool`, `IndexUrlResult`, `IndexUrlFn` from
  `./index-url.js` (Task 2).
- Produces: `@yomi/agent-core` now exports `createIndexUrlTool` — Task 5 imports
  it from there.

- [ ] **Step 1: Add the export**

In `packages/agent-core/src/index.ts`, immediately after the existing block:

```ts
export {
  createIndexTextTool,
  type IndexTextResult,
  type IndexTextFn,
} from "./index-text.js"
```

add:

```ts
export {
  createIndexUrlTool,
  type IndexUrlResult,
  type IndexUrlFn,
} from "./index-url.js"
```

- [ ] **Step 2: Typecheck the package**

Run: `bun run typecheck` Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-core/src/index.ts
git commit -m "feat(agent-core): export createIndexUrlTool"
```

---

### Task 4: `url-ingest.ts` backend service

**Files:**

- Create: `apps/backend/src/services/rag/url-ingest.ts`
- Create: `apps/backend/src/services/rag/url-ingest.test.ts`

**Interfaces:**

- Consumes: `resolvesToDisallowedAddress` from `@yomi/agent-core` (already
  exported there — confirmed at `packages/agent-core/src/index.ts:27`);
  `indexDocument` from `./index-document.js` (existing); `checkConsent` from
  `../privacy/checks.js` (existing); `ensureSource` from `./source-lookup.js`
  (Task 1).
- Produces:

  ```ts
  export type UrlExtractResult =
    | { title: string; text: string; normalizedUrl: string }
    | { error: string }
  export async function fetchAndExtractUrl(
    rawUrl: string,
  ): Promise<UrlExtractResult>
  export async function indexUrl(
    userId: string,
    rawUrl: string,
  ): Promise<
    { ok: true; documentId: string; title: string } | { error: string }
  >
  ```

  Task 5 consumes `indexUrl` by this exact name and signature, imported from
  `../services/rag/url-ingest.js`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/services/rag/url-ingest.test.ts` with this content:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let disallowedAddress = false
mock.module("@yomi/agent-core", () => ({
  resolvesToDisallowedAddress: async () => disallowedAddress,
}))

let ensureSourceCalls: { userId: string; opts: Record<string, unknown> }[] = []
mock.module("./source-lookup.js", () => ({
  ensureSource: async (userId: string, opts: Record<string, unknown>) => {
    ensureSourceCalls.push({ userId, opts })
    return "url-source-1"
  },
}))

let consentAllowed = true
let consentReason: string | null = "not granted"
mock.module("../privacy/checks.js", () => ({
  checkConsent: async () => ({
    allowed: consentAllowed,
    reason: consentReason,
  }),
}))

let indexDocumentResult: {
  status: "indexed" | "unchanged"
  documentId: string | null
} = {
  status: "indexed",
  documentId: "doc-1",
}
let indexDocumentCalls: Record<string, unknown>[] = []
mock.module("./index-document.js", () => ({
  indexDocument: async (input: Record<string, unknown>) => {
    indexDocumentCalls.push(input)
    return indexDocumentResult
  },
}))

const { fetchAndExtractUrl, indexUrl } = await import("./url-ingest.js")

const realFetch = globalThis.fetch

function htmlResponse(
  body: string,
  init: { status?: number; contentType?: string; contentLength?: string } = {},
): Response {
  const headers = new Headers()
  headers.set("content-type", init.contentType ?? "text/html")
  if (init.contentLength) headers.set("content-length", init.contentLength)
  return new Response(body, { status: init.status ?? 200, headers })
}

beforeEach(() => {
  disallowedAddress = false
  ensureSourceCalls = []
  consentAllowed = true
  consentReason = "not granted"
  indexDocumentResult = { status: "indexed", documentId: "doc-1" }
  indexDocumentCalls = []
  globalThis.fetch = realFetch
})

describe("fetchAndExtractUrl", () => {
  it("rejects a non-http(s) scheme", async () => {
    const result = await fetchAndExtractUrl("ftp://example.com/file")
    expect(result).toEqual({ error: "only http and https URLs can be indexed" })
  })

  it("rejects an unparseable URL", async () => {
    const result = await fetchAndExtractUrl("not a url")
    expect(result).toEqual({ error: "only http and https URLs can be indexed" })
  })

  it("rejects a URL that resolves to a disallowed address", async () => {
    disallowedAddress = true
    globalThis.fetch = mock(async () =>
      htmlResponse("<html></html>"),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "that URL cannot be fetched" })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("rejects a redirect response", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("", { status: 302 }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({
      error: "that URL redirects, which isn't supported yet",
    })
  })

  it("rejects when fetch throws (timeout/network failure)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "failed to fetch that URL" })
  })

  it("rejects a non-2xx response", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("", { status: 500 }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "fetch failed with status 500" })
  })

  it("rejects an unsupported content-type", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("binary", { contentType: "application/pdf" }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/file.pdf")

    expect(result).toEqual({
      error: "only HTML and plain-text pages can be indexed",
    })
  })

  it("rejects an oversized page via Content-Length", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html></html>", { contentLength: "3000000" }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "that page is too large to index" })
  })

  it("rejects an oversized page via actual body size", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("x".repeat(2_000_001)),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "that page is too large to index" })
  })

  it("extracts title and strips HTML tags/scripts/styles", async () => {
    const html =
      "<html><head><title>My Article</title><style>body{color:red}</style></head>" +
      "<body><script>alert(1)</script><h1>Hello</h1><p>World</p></body></html>"
    globalThis.fetch = mock(async () =>
      htmlResponse(html),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/article")

    expect(result).toEqual({
      title: "My Article",
      text: "Hello World",
      normalizedUrl: "https://example.com/article",
    })
  })

  it("falls back to the URL as the title when no <title> is present", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><body><p>No title here</p></body></html>"),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/no-title")

    expect(result).toEqual({
      title: "https://example.com/no-title",
      text: "No title here",
      normalizedUrl: "https://example.com/no-title",
    })
  })

  it("uses plain-text content as-is, with the URL as title", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("just some plain text", { contentType: "text/plain" }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/notes.txt")

    expect(result).toEqual({
      title: "https://example.com/notes.txt",
      text: "just some plain text",
      normalizedUrl: "https://example.com/notes.txt",
    })
  })

  it("strips the URL fragment from normalizedUrl", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><title>T</title><body>x</body></html>"),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl(
      "https://example.com/page#section-2",
    )

    expect(result).toEqual({
      title: "T",
      text: "x",
      normalizedUrl: "https://example.com/page",
    })
  })
})

describe("indexUrl", () => {
  it("returns an error and does not fetch when consent is denied", async () => {
    consentAllowed = false
    globalThis.fetch = mock(async () =>
      htmlResponse("<html></html>"),
    ) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({
      error: "cloud memory consent not granted: not granted",
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("passes an extraction error through unchanged", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "failed to fetch that URL" })
    expect(indexDocumentCalls).toHaveLength(0)
  })

  it("indexes successfully using the normalized URL as externalId", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><title>Article</title><body>Body text</body></html>"),
    ) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com/article#top")

    expect(result).toEqual({ ok: true, documentId: "doc-1", title: "Article" })
    expect(indexDocumentCalls).toHaveLength(1)
    const call = indexDocumentCalls[0]!
    expect(call["userId"]).toBe("u1")
    expect(call["externalId"]).toBe("https://example.com/article")
    expect(call["title"]).toBe("Article")
    expect(call["mimeType"]).toBe("text/html")
    expect(ensureSourceCalls).toEqual([
      {
        userId: "u1",
        opts: { path: "indexed-urls", name: "Indexed URLs", sourceType: "url" },
      },
    ])
  })

  it("re-indexing the same URL reuses the same externalId", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><title>Article</title><body>Body text</body></html>"),
    ) as unknown as typeof fetch

    await indexUrl("u1", "https://example.com/article")
    await indexUrl("u1", "https://example.com/article")

    expect(indexDocumentCalls).toHaveLength(2)
    expect(indexDocumentCalls[0]!["externalId"]).toBe(
      indexDocumentCalls[1]!["externalId"],
    )
  })

  it("returns an error when indexDocument returns no documentId", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><body>x</body></html>"),
    ) as unknown as typeof fetch
    indexDocumentResult = { status: "unchanged", documentId: null }

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when an unexpected exception occurs", async () => {
    globalThis.fetch = mock(async () => {
      throw { notAnError: true }
    }) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "failed to fetch that URL" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/services/rag/url-ingest.test.ts`
Expected: FAIL — `url-ingest.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/backend/src/services/rag/url-ingest.ts` with this content:

```ts
import { resolvesToDisallowedAddress } from "@yomi/agent-core"
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"
import { ensureSource } from "./source-lookup.js"

const URL_SOURCE_TYPE = "url"
const URL_SOURCE_NAME = "Indexed URLs"
const URL_SOURCE_PATH = "indexed-urls"

const MAX_BODY_BYTES = 2_000_000
const FETCH_TIMEOUT_MS = 10_000

export type UrlExtractResult =
  | { title: string; text: string; normalizedUrl: string }
  | { error: string }

function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = match?.[1]?.trim()
  return title || fallback
}

function stripHtml(html: string): string {
  return html
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Fetches a user-supplied URL and extracts its readable text. Never throws — every
// failure path (invalid URL, SSRF-blocked address, redirect, timeout, non-2xx, wrong
// content-type, oversized body) returns { error } with a specific, distinct message.
export async function fetchAndExtractUrl(
  rawUrl: string,
): Promise<UrlExtractResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { error: "only http and https URLs can be indexed" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "only http and https URLs can be indexed" }
  }
  url.hash = ""
  const normalizedUrl = url.toString()

  if (await resolvesToDisallowedAddress(url.hostname)) {
    return { error: "that URL cannot be fetched" }
  }

  let response: Response
  try {
    response = await fetch(normalizedUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return { error: "failed to fetch that URL" }
  }

  if (response.status >= 300 && response.status < 400) {
    return { error: "that URL redirects, which isn't supported yet" }
  }
  if (!response.ok) {
    return { error: `fetch failed with status ${response.status}` }
  }

  const contentLength = response.headers.get("content-length")
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return { error: "that page is too large to index" }
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
  const isHtml = contentType.startsWith("text/html")
  const isPlainText = contentType.startsWith("text/plain")
  if (!isHtml && !isPlainText) {
    return { error: "only HTML and plain-text pages can be indexed" }
  }

  let buffer: ArrayBuffer
  try {
    buffer = await response.arrayBuffer()
  } catch {
    return { error: "failed to fetch that URL" }
  }
  if (buffer.byteLength > MAX_BODY_BYTES) {
    return { error: "that page is too large to index" }
  }

  const raw = new TextDecoder().decode(buffer)
  if (isHtml) {
    return {
      title: extractTitle(raw, normalizedUrl),
      text: stripHtml(raw),
      normalizedUrl,
    }
  }
  return { title: normalizedUrl, text: raw.trim(), normalizedUrl }
}

// Consent-gated wrapper: fetch + extract + index. Never throws, same reasoning as
// indexManualText — the whole body is guarded so a failure here can't kill the
// parent agent turn.
export async function indexUrl(
  userId: string,
  rawUrl: string,
): Promise<
  { ok: true; documentId: string; title: string } | { error: string }
> {
  try {
    const consent = await checkConsent(userId, "cloud_memory")
    if (!consent.allowed) {
      return {
        error: `cloud memory consent not granted${consent.reason ? `: ${consent.reason}` : ""}`,
      }
    }

    const extracted = await fetchAndExtractUrl(rawUrl)
    if ("error" in extracted) return extracted

    const sourceId = await ensureSource(userId, {
      path: URL_SOURCE_PATH,
      name: URL_SOURCE_NAME,
      sourceType: URL_SOURCE_TYPE,
    })
    const result = await indexDocument({
      userId,
      sourceId,
      externalId: extracted.normalizedUrl,
      title: extracted.title,
      mimeType: "text/html",
      text: extracted.text,
    })
    if (!result.documentId) return { error: "failed to index" }
    return { ok: true, documentId: result.documentId, title: extracted.title }
  } catch (err) {
    console.error(
      "[indexUrl] failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return { error: "failed to index" }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/rag/url-ingest.test.ts`
Expected: PASS — 19 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/rag/url-ingest.ts apps/backend/src/services/rag/url-ingest.test.ts
git commit -m "feat(rag): add SSRF-safe URL fetch, extract, and index"
```

---

### Task 5: Wire `index_url` into the backend agent

**Files:**

- Modify: `apps/backend/src/agent/run.ts` — import block (~lines 4-21),
  `isOwnerUser`/`effectivePlanForUser` gate block (~lines 574-583), `extraTools`
  object (~lines 589-596)
- Modify: `apps/backend/src/agent/run.test.ts`

**Interfaces:**

- Consumes: `createIndexUrlTool` from `@yomi/agent-core` (Task 3); `indexUrl`
  from `../services/rag/url-ingest.js` (Task 4). The existing in-scope
  `canUseRag` boolean (already computed for `index_text`'s gate — reused as-is,
  not recomputed).
- Produces: nothing new for later tasks — this is the final integration point
  for this plan.

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/agent/run.test.ts`, find the existing `index_text` wiring
tests:

```ts
it("wires an index_text tool into extraTools for a Pro-plan user", async () => {
  mockUser = makeUser({ plan: "pro" })
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  const indexTextTool = lastAgentExtraTools!["index_text"] as {
    execute?: unknown
    description?: string
  }
  expect(typeof indexTextTool.execute).toBe("function")
  expect(indexTextTool.description).toContain("index")
})

it("omits index_text from extraTools for an Explore-plan user", async () => {
  mockUser = makeUser({ plan: "explore" })
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  expect(lastAgentExtraTools!["index_text"]).toBeUndefined()
})
```

Add two new tests immediately after them:

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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test --isolate apps/backend/src/agent/run.test.ts -t "index_url"`
Expected: FAIL — `lastAgentExtraTools!["index_url"]` is `undefined` in the first
new test (the wiring doesn't exist yet).

- [ ] **Step 3: Add the imports**

In `apps/backend/src/agent/run.ts`, the `@yomi/agent-core` import block
currently reads:

```ts
import {
  ConnectorRegistry,
  createDeepResearchTool,
  createDelegateTool,
  createIndexTextTool,
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

Change it to (adding `createIndexUrlTool` in alphabetical position):

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

Find this line:

```ts
import { indexManualText } from "../services/rag/manual-source.js"
```

Add a new import immediately after it:

```ts
import { indexManualText } from "../services/rag/manual-source.js"
import { indexUrl } from "../services/rag/url-ingest.js"
```

- [ ] **Step 4: Construct the tool and add it to `extraTools`**

Find this block:

```ts
  // Cloud RAG is a paid-plan feature at the REST layer (ragAllowed() in routes/rag.ts) —
  // index_text must not be a side door around that for an Explore user. Rather than add
  // the tool and have it always error for Explore, it's simply absent from extraTools.
  const canUseRag =
    isOwnerUser(user) ||
    effectivePlanForUser(user) === "pro" ||
    effectivePlanForUser(user) === "max"
  const indexTextTool = canUseRag
    ? createIndexTextTool((title, content) => indexManualText(opts.userId, title, content))
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
        ...(reactionTool ? { react_to_message: reactionTool } : {}),
      },
```

Change it to:

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
  const indexUrlTool = canUseRag
    ? createIndexUrlTool((url) => indexUrl(opts.userId, url))
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
git commit -m "feat(agent): wire index_url tool into the backend agent"
```

---

## Final Verification

- [ ] Run `bun run format` proactively (every PR this session has needed this at
      least once — run it before pushing, then re-verify tests still pass).
- [ ] Run `bun run lint`.
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate packages/agent-core/src` from repo root — all
      pass.
- [ ] Run `bun test --isolate apps/backend/src` from repo root — all pass.
- [ ] Re-read `docs/superpowers/specs/2026-08-03-rag-index-url-design.md` and
      confirm every section (SSRF protection, fetch bounds, extraction,
      source/document keying, gating, interface, error handling) has a
      corresponding implemented piece.
