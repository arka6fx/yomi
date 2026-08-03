# RAG index_text Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `index_text` tool the backend agent can call to index arbitrary
pasted text into the user's cloud RAG archive, gated by the same consent and
plan checks the existing `/rag/*` REST routes enforce.

**Architecture:** One new agent-core file (`index-text.ts`) exporting a
`createIndexTextTool` factory that wraps an injected backend callback (same
shape as `createRagSearchTool`/`createMemorySearchTool` in `deep-research.ts`);
one new backend service file (`manual-source.ts`) providing an idempotent
get-or-create "Chat notes" source plus the consent-gated call into the existing
`indexDocument()` helper; wired into `apps/backend/src/agent/run.ts`'s
`extraTools`, but only when the user's plan qualifies for Cloud RAG.

**Tech Stack:** Bun, `ai` SDK's `tool()`/`zod`, Drizzle ORM, TypeScript,
`bun:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-rag-index-text-design.md` — this plan
  implements it exactly; do not deviate without re-checking that file.
- Consent gate: `checkConsent(userId, "cloud_memory")` — checked inside
  `indexManualText` itself, before any write. Denial returns
  `{ error: "cloud memory consent not granted" }`, never throws.
- Plan gate:
  `isOwnerUser(user) || effectivePlanForUser(user) === "pro" || effectivePlanForUser(user) === "max"`
  — checked in `run.ts` at tool-construction time. When it fails, `index_text`
  is simply **absent** from `extraTools` (not present-and-always-erroring).
- Source keying: one persistent per-user `ragSources` row,
  `sourceType: "manual"` (constant `MANUAL_SOURCE_TYPE = "manual"`),
  `name: "Chat notes"`, get-or-created idempotently.
- Document keying: every `index_text` call creates a **new** document under that
  source, keyed by a fresh `crypto.randomUUID()` as `externalId` — never a
  title-derived key, so repeated pastes never silently overwrite each other.
- Reuses `indexDocument()` from `services/rag/index-document.js` as-is — no new
  chunk/embed logic.
- `indexManualText` wraps its `indexDocument()` call in try/catch, returning
  `{ error: "failed to index" }` on any exception — never throws (matches
  `delegate`/`deep_research`'s degrade-gracefully contract from item 6/5's
  reviews).
- Success returns `{ ok: true, documentId: string }`; failure returns
  `{ error: string }` — the union type is `IndexTextResult`.
- Conventional commit messages (`feat:`, `test:`), lowercase, no full stop, max
  72 chars, per `AGENTS.md`.
- Test commands, run from repo root:
  - `bun test --isolate packages/agent-core/src/index-text.test.ts` (Task 1)
  - `bun test --isolate apps/backend/src/services/rag/manual-source.test.ts`
    (Task 3)
  - `bun test --isolate apps/backend/src/agent/run.test.ts` (Task 4)

---

## File Structure

- Create: `packages/agent-core/src/index-text.ts` — `createIndexTextTool`
  factory, `IndexTextResult`/`IndexTextFn` types.
- Create: `packages/agent-core/src/index-text.test.ts` — tests for the factory.
- Modify: `packages/agent-core/src/index.ts` — export the new symbols.
- Create: `apps/backend/src/services/rag/manual-source.ts` —
  `MANUAL_SOURCE_TYPE`, `ensureManualSource`, `indexManualText`.
- Create: `apps/backend/src/services/rag/manual-source.test.ts` — tests for both
  functions.
- Modify: `apps/backend/src/agent/run.ts` — import `isOwnerUser`,
  `createIndexTextTool`, `indexManualText`; compute the plan gate; conditionally
  add `index_text` to `extraTools`.
- Modify: `apps/backend/src/agent/run.test.ts` — wiring tests proving
  `index_text` is present for a Pro-plan user and absent for an Explore-plan
  user.

---

### Task 1: `createIndexTextTool` in agent-core

**Files:**

- Create: `packages/agent-core/src/index-text.ts`
- Create: `packages/agent-core/src/index-text.test.ts`

**Interfaces:**

- Consumes: `tool` from `ai`, `z` from `zod` (same imports every other
  agent-core tool factory uses).
- Produces:

  ```ts
  export type IndexTextResult =
    | { ok: true; documentId: string }
    | { error: string }
  export type IndexTextFn = (
    title: string,
    content: string,
  ) => Promise<IndexTextResult>
  export function createIndexTextTool(indexText: IndexTextFn)
  ```

  Task 4 consumes `createIndexTextTool` by this exact name (imported via
  `@yomi/agent-core` after Task 2 exports it).

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-core/src/index-text.test.ts` with this content:

```ts
import { describe, expect, it } from "bun:test"
import { createIndexTextTool, type IndexTextFn } from "./index-text.js"

describe("createIndexTextTool", () => {
  it("returns a tool with the correct shape", () => {
    const indexText: IndexTextFn = async () => ({
      ok: true,
      documentId: "doc-1",
    })
    const t = createIndexTextTool(indexText)
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("index")
    expect(t.parameters).toBeDefined()
  })

  it("calls the injected indexText callback with title and content", async () => {
    let calledArgs: [string, string] | null = null
    const indexText: IndexTextFn = async (title, content) => {
      calledArgs = [title, content]
      return { ok: true, documentId: "doc-1" }
    }
    const t = createIndexTextTool(indexText)

    const result = await t.execute!(
      { title: "Meeting notes", content: "We decided to ship on Friday." },
      {} as never,
    )

    expect(calledArgs).toEqual([
      "Meeting notes",
      "We decided to ship on Friday.",
    ])
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  it("passes an error result through unchanged", async () => {
    const indexText: IndexTextFn = async () => ({
      error: "cloud memory consent not granted",
    })
    const t = createIndexTextTool(indexText)

    const result = await t.execute!({ title: "x", content: "y" }, {} as never)

    expect(result).toEqual({ error: "cloud memory consent not granted" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate packages/agent-core/src/index-text.test.ts` Expected:
FAIL — `index-text.js` does not exist yet (module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/agent-core/src/index-text.ts` with this content:

```ts
import { tool } from "ai"
import { z } from "zod"

export type IndexTextResult =
  | { ok: true; documentId: string }
  | { error: string }
export type IndexTextFn = (
  title: string,
  content: string,
) => Promise<IndexTextResult>

export function createIndexTextTool(indexText: IndexTextFn) {
  return tool({
    description:
      "Index a piece of text into the user's searchable cloud archive so it can be " +
      "found later by rag_search or the deep_research tool. Use this when the user " +
      "pastes text and asks you to remember, save, or index it.",
    parameters: z.object({
      title: z
        .string()
        .min(1)
        .max(200)
        .describe("A short, descriptive title for this content"),
      content: z.string().min(1).max(100_000).describe("The text to index"),
    }),
    execute: async ({ title, content }) => indexText(title, content),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate packages/agent-core/src/index-text.test.ts` Expected:
PASS — 3 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/index-text.ts packages/agent-core/src/index-text.test.ts
git commit -m "feat(agent-core): add index_text tool for cloud RAG"
```

---

### Task 2: Export from agent-core's public API

**Files:**

- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**

- Consumes: `createIndexTextTool`, `IndexTextResult`, `IndexTextFn` from
  `./index-text.js` (Task 1).
- Produces: `@yomi/agent-core` now exports `createIndexTextTool` — Task 4
  imports it from there.

- [ ] **Step 1: Add the export**

In `packages/agent-core/src/index.ts`, immediately after the existing block:

```ts
export {
  createDeepResearchTool,
  type CreateDeepResearchToolOptions,
  type RagSearchResult,
  type RagSearchFn,
  type MemorySearchResult,
  type MemorySearchFn,
  type WebSearchResultLike,
  type DeepResearchRunLoopFn,
} from "./deep-research.js"
```

add:

```ts
export {
  createIndexTextTool,
  type IndexTextResult,
  type IndexTextFn,
} from "./index-text.js"
```

- [ ] **Step 2: Typecheck the package**

Run: `bun run typecheck` Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-core/src/index.ts
git commit -m "feat(agent-core): export createIndexTextTool"
```

---

### Task 3: `manual-source.ts` backend service

**Files:**

- Create: `apps/backend/src/services/rag/manual-source.ts`
- Create: `apps/backend/src/services/rag/manual-source.test.ts`

**Interfaces:**

- Consumes: `db`, `ragSources` from `@yomi/db`; `and`, `eq` from `drizzle-orm`;
  `indexDocument` from `./index-document.js` (existing); `checkConsent` from
  `../privacy/checks.js` (existing).
- Produces:

  ```ts
  export const MANUAL_SOURCE_TYPE = "manual"
  export async function ensureManualSource(userId: string): Promise<string>
  export async function indexManualText(
    userId: string,
    title: string,
    content: string,
  ): Promise<{ ok: true; documentId: string } | { error: string }>
  ```

  Task 4 consumes `indexManualText` by this exact name and signature, imported
  from `../services/rag/manual-source.js`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/services/rag/manual-source.test.ts` with this content:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectRows: { id: string }[] = []
let insertedSources: Record<string, unknown>[] = []
let nextSourceId = 1

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selectRows) }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          const id = `source-${nextSourceId++}`
          insertedSources.push({ id, ...v })
          return Promise.resolve([{ id, ...v }])
        },
      }),
    }),
  },
  ragSources: { __name: "rag_sources" },
}))

let consentAllowed = true
mock.module("../privacy/checks.js", () => ({
  checkConsent: async () => ({ allowed: consentAllowed, reason: null }),
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
  selectRows = []
  insertedSources = []
  nextSourceId = 1
  consentAllowed = true
  indexDocumentResult = { status: "indexed", documentId: "doc-1" }
  indexDocumentShouldThrow = false
  indexDocumentCalls = []
})

describe("ensureManualSource", () => {
  it("creates a source on first call", async () => {
    const id = await ensureManualSource("u1")
    expect(id).toBe("source-1")
    expect(insertedSources).toHaveLength(1)
    expect(insertedSources[0]!["sourceType"]).toBe(MANUAL_SOURCE_TYPE)
    expect(insertedSources[0]!["userId"]).toBe("u1")
  })

  it("reuses the existing source on a later call", async () => {
    selectRows = [{ id: "existing-source" }]
    const id = await ensureManualSource("u1")
    expect(id).toBe("existing-source")
    expect(insertedSources).toHaveLength(0)
  })
})

describe("indexManualText", () => {
  it("returns an error and does not call indexDocument when consent is denied", async () => {
    consentAllowed = false

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "cloud memory consent not granted" })
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

  it("returns an error when indexDocument reports unchanged with no documentId", async () => {
    indexDocumentResult = { status: "unchanged", documentId: null }

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when indexDocument rejects", async () => {
    indexDocumentShouldThrow = true

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "failed to index" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/services/rag/manual-source.test.ts`
Expected: FAIL — `manual-source.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/backend/src/services/rag/manual-source.ts` with this content:

```ts
import { and, eq } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"

export const MANUAL_SOURCE_TYPE = "manual"
const MANUAL_SOURCE_NAME = "Chat notes"

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
        eq(ragSources.sourceType, MANUAL_SOURCE_TYPE),
      ),
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(ragSources)
    .values({
      userId,
      name: MANUAL_SOURCE_NAME,
      sourceType: MANUAL_SOURCE_TYPE,
      status: "ready",
    })
    .returning()
  return created!.id
}

// Consent-gated wrapper around indexDocument() for agent-triggered text pastes. Never
// throws — a thrown error from indexDocument would otherwise propagate out of the
// index_text tool's execute and kill the whole parent turn (same class of bug fixed
// for delegate/deep_research after item 6/5's final reviews).
export async function indexManualText(
  userId: string,
  title: string,
  content: string,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  const consent = await checkConsent(userId, "cloud_memory")
  if (!consent.allowed) return { error: "cloud memory consent not granted" }

  try {
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
  } catch {
    return { error: "failed to index" }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/rag/manual-source.test.ts`
Expected: PASS — 8 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/rag/manual-source.ts apps/backend/src/services/rag/manual-source.test.ts
git commit -m "feat(rag): add manual-source get-or-create and indexManualText"
```

---

### Task 4: Wire `index_text` into the backend agent

**Files:**

- Modify: `apps/backend/src/agent/run.ts:4-20` (import block), `:34`
  (entitlements import), `:504-571` (tool construction block, immediately after
  `deepResearchTool`), `:577-583` (`extraTools` object)
- Modify: `apps/backend/src/agent/run.test.ts`

**Interfaces:**

- Consumes: `createIndexTextTool` from `@yomi/agent-core` (Task 2);
  `indexManualText` from `../services/rag/manual-source.js` (Task 3);
  `isOwnerUser` from `../entitlements.js` (not yet imported in this file — new
  import). The existing in-scope `user` (fetched earlier in `runAgent`),
  `agentModel`/`effectivePlanForUser` (already computed/imported).
- Produces: nothing new for later tasks — this is the final integration point
  for this sub-item.

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/agent/run.test.ts`, find the existing `deep_research`
wiring test:

```ts
it("wires a deep_research tool into extraTools", async () => {
  mockUser = makeUser()
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  const researchTool = lastAgentExtraTools!["deep_research"] as {
    execute?: unknown
    description?: string
  }
  expect(typeof researchTool.execute).toBe("function")
  expect(researchTool.description).toContain("cited")
})
```

Add two new tests immediately after it:

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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test --isolate apps/backend/src/agent/run.test.ts -t "index_text"`
Expected: FAIL — `lastAgentExtraTools!["index_text"]` is `undefined` in the
first new test (the wiring doesn't exist yet), and the second test's
`toBeUndefined()` check trivially passes for the wrong reason (nothing is wired
for ANY plan yet) — that's fine, it becomes a meaningful assertion once Step 4
below makes the Pro-plan case wire the tool.

- [ ] **Step 3: Add the imports**

In `apps/backend/src/agent/run.ts`, the `@yomi/agent-core` import block
currently reads:

```ts
import {
  ConnectorRegistry,
  createDeepResearchTool,
  createDelegateTool,
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

Change it to (adding `createIndexTextTool` in alphabetical position among the
value imports):

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

Find this line:

```ts
import { hasBillablePlanAccess, effectivePlanForUser } from "../entitlements.js"
```

Change it to:

```ts
import {
  hasBillablePlanAccess,
  effectivePlanForUser,
  isOwnerUser,
} from "../entitlements.js"
```

Find this line:

```ts
import { searchMemoryEntries } from "../services/memory/search.js"
```

Add a new import immediately after it:

```ts
import { searchMemoryEntries } from "../services/memory/search.js"
import { indexManualText } from "../services/rag/manual-source.js"
```

- [ ] **Step 4: Construct the tool and add it to `extraTools`**

Find the end of the `deepResearchTool` construction block (immediately before
the `try {` that starts the `runAgentLoop` call):

```ts
  const deepResearchTool = createDeepResearchTool({
    registry: researchRegistry,
    // Gated the same way passive injection is above (memoryConsent/cloudMemoryConsent) —
    // deep_research must not give the model a side door around a denied consent.
    ragSearch: (query, limit) =>
      cloudMemoryConsent.allowed
        ? searchRagDocuments(opts.userId, query, limit)
        : Promise.resolve([]),
    memorySearch: (query, limit) =>
      memoryConsent.allowed ? searchMemoryEntries(opts.userId, query, limit) : Promise.resolve([]),
    webSearch: (query) => searchWeb(query, opts.signal),
    model: agentModel,
    system: agentSystem,
    signal: opts.signal,
    onUsage: (usage: UsageInfo) => {
      recordAiUsage({
        userId: opts.userId,
        requestId: crypto.randomUUID(),
        usageEventId: usageEventId ?? null,
        endpoint: "backend.agent",
        surface: "telegram",
        route: "agent.deep_research",
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        latencyMs: Date.now() - startedAt,
        status: "done",
      }).catch(() => {})
    },
  })
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
        ...(reactionTool ? { react_to_message: reactionTool } : {}),
      },
```

Change it to:

```ts
  const deepResearchTool = createDeepResearchTool({
    registry: researchRegistry,
    // Gated the same way passive injection is above (memoryConsent/cloudMemoryConsent) —
    // deep_research must not give the model a side door around a denied consent.
    ragSearch: (query, limit) =>
      cloudMemoryConsent.allowed
        ? searchRagDocuments(opts.userId, query, limit)
        : Promise.resolve([]),
    memorySearch: (query, limit) =>
      memoryConsent.allowed ? searchMemoryEntries(opts.userId, query, limit) : Promise.resolve([]),
    webSearch: (query) => searchWeb(query, opts.signal),
    model: agentModel,
    system: agentSystem,
    signal: opts.signal,
    onUsage: (usage: UsageInfo) => {
      recordAiUsage({
        userId: opts.userId,
        requestId: crypto.randomUUID(),
        usageEventId: usageEventId ?? null,
        endpoint: "backend.agent",
        surface: "telegram",
        route: "agent.deep_research",
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        latencyMs: Date.now() - startedAt,
        status: "done",
      }).catch(() => {})
    },
  })
  // Cloud RAG is a paid-plan feature at the REST layer (ragAllowed() in routes/rag.ts) —
  // index_text must not be a side door around that for an Explore user. Rather than add
  // the tool and have it always error for Explore, it's simply absent from extraTools.
  const canUseRag =
    isOwnerUser(user) || effectivePlanForUser(user) === "pro" || effectivePlanForUser(user) === "max"
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

- [ ] **Step 5: Run the full test file to verify everything passes**

Run: `bun test --isolate apps/backend/src/agent/run.test.ts` Expected: PASS —
all existing tests plus the two new ones added in Step 1.

- [ ] **Step 6: Typecheck and run the full backend + agent-core suites**

Run: `bun run typecheck` Expected: 0 errors.

Run: `bun test --isolate apps/backend/src` Expected: all pass.

Run: `bun test --isolate packages/agent-core/src` Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/agent/run.ts apps/backend/src/agent/run.test.ts
git commit -m "feat(agent): wire index_text tool into the backend agent"
```

---

## Final Verification

- [ ] Run `bun run format` (this session's last three PRs all failed CI on
      `format:check` — run this proactively, then re-verify tests still pass,
      before pushing).
- [ ] Run `bun run lint` (AGENTS.md: CI runs lint; it's part of the pre-push
      checklist).
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate packages/agent-core/src` from repo root — all
      pass.
- [ ] Run `bun test --isolate apps/backend/src` from repo root — all pass.
- [ ] Re-read `docs/superpowers/specs/2026-08-03-rag-index-text-design.md` and
      confirm every section (gating, source/document keying, interface, wiring,
      error handling) has a corresponding implemented piece.
