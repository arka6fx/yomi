# Deep-Research Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `deep_research` tool the backend agent can call to research a
question across RAG, memory, and the web via a bounded sub-loop, returning a
synthesized, cited answer.

**Architecture:** One new agent-core file (`deep-research.ts`) exporting
`createDeepResearchTool` plus two small tool factories (`createRagSearchTool`,
`createMemorySearchTool`) that only it consumes; two new backend query functions
(`searchRagDocuments`, `searchMemoryEntries`) that the existing
passive-injection functions (`fetchRagContext`, `fetchMemoryContext`) are
refactored to reuse; wired into `apps/backend/src/agent/run.ts`'s `extraTools`
alongside `delegate`.

**Tech Stack:** Bun, `ai` SDK's `tool()`/`zod`, Drizzle ORM, TypeScript,
`bun:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-deep-research-tool-design.md` — this
  plan implements it exactly; do not deviate without re-checking that file.
- No connector access: the sub-loop's registry is a `ConnectorRegistry` that is
  **never** `.init()`'d, so it naturally contributes zero connector tools.
- Sub-loop budget is fixed and non-configurable: `maxSteps: 12`,
  `maxOutputTokens: 6144`.
- Per-turn cap: at most 2 `deep_research` calls per constructed tool instance.
  The 3rd+ call returns `{ error: "research limit (2 per turn) reached" }` and
  does **not** call the sub-loop.
- The sub-loop's `extraTools` contains exactly `rag_search`, `memory_search`,
  `web_search` — never `delegate` or `deep_research` (recursion bound, same
  reasoning as item 6).
- `CreateDeepResearchToolOptions` includes `onUsage`/`system` from the start
  (lessons already learned from item 6's final review — not bolted on after this
  plan's own review).
- `packages/agent-core`'s `bun test` script has **no** `--isolate` flag — do not
  use `mock.module` to fake `./agent.js` in this package's tests.
  `createDeepResearchTool` takes an optional, injectable `runLoop` parameter
  (defaulting to the real `runAgentLoop`), same pattern as `delegate.ts`.
- Success returns `{ result: string }`; cap-exceeded returns `{ error: string }`
  — never throws.
- `searchRagDocuments`/`searchMemoryEntries` each degrade to `[]` on failure or
  empty query — never throw.
- Conventional commit messages (`feat:`, `test:`), lowercase, no full stop, max
  72 chars, per `AGENTS.md`.
- Test commands, run from repo root:
  - `bun test --isolate packages/agent-core/src/deep-research.test.ts` (Task 1)
  - `bun test --isolate apps/backend/src/services/rag/search.test.ts` (Task 3)
  - `bun test --isolate apps/backend/src/services/memory/search.test.ts`
    (Task 4)
  - `bun test --isolate apps/backend/src/agent/run.test.ts` (Task 5)

---

## File Structure

- Create: `packages/agent-core/src/deep-research.ts` — `createDeepResearchTool`,
  `createRagSearchTool`, `createMemorySearchTool` (single-consumer factories,
  co-located rather than split — only `deep-research.ts` uses them).
- Create: `packages/agent-core/src/deep-research.test.ts` — tests for all of the
  above.
- Modify: `packages/agent-core/src/index.ts` — export the three new symbols and
  their types.
- Create: `apps/backend/src/services/rag/search.ts` — `searchRagDocuments`.
- Create: `apps/backend/src/services/rag/search.test.ts` — tests for it.
- Modify: `apps/backend/src/services/memory/search.ts` — add
  `searchMemoryEntries`.
- Modify: `apps/backend/src/services/memory/search.test.ts` — convert to dynamic
  import (needed so `@yomi/db` can be mocked before the module loads) and add
  tests for `searchMemoryEntries`.
- Modify: `apps/backend/src/agent/run.ts` — refactor
  `fetchRagContext`/`fetchMemoryContext` to call the new functions; construct
  `researchRegistry` + `deepResearchTool`; add to `extraTools`.
- Modify: `apps/backend/src/agent/run.test.ts` — wiring test for
  `deep_research`.

---

### Task 1: `createDeepResearchTool` in agent-core

**Files:**

- Create: `packages/agent-core/src/deep-research.ts`
- Create: `packages/agent-core/src/deep-research.test.ts`

**Interfaces:**

- Consumes: `runAgentLoop`, `RunAgentLoopOptions`, `UsageInfo` from
  `./agent.js`; `ConnectorRegistry` type from `./connectors/registry.js`.
- Produces:

  ```ts
  export type RagSearchResult = {
    sourceName: string
    title: string
    content: string
  }
  export type RagSearchFn = (
    query: string,
    limit: number,
  ) => Promise<RagSearchResult[]>
  export type MemorySearchResult = {
    kind: string
    topic: string
    content: string
    sourcePath: string | null
    isStatic: boolean
    updatedAt: string | Date
    score: number
    matchedBy: string[]
  }
  export type MemorySearchFn = (
    query: string,
    limit: number,
  ) => Promise<MemorySearchResult[]>
  export type DeepResearchRunLoopFn = (
    opts: RunAgentLoopOptions,
  ) => Promise<string>
  export interface CreateDeepResearchToolOptions {
    registry: ConnectorRegistry
    ragSearch: RagSearchFn
    memorySearch: MemorySearchFn
    webSearch: (query: string) => Promise<{
      answer: string
      citations: { title: string; url: string }[]
    }>
    model?: string
    system?: string
    signal?: AbortSignal
    onUsage?: (usage: UsageInfo) => void
    runLoop?: DeepResearchRunLoopFn
  }
  export function createDeepResearchTool(opts: CreateDeepResearchToolOptions)
  ```

  Task 5 consumes `createDeepResearchTool`/`CreateDeepResearchToolOptions` by
  these exact names (imported via `@yomi/agent-core` after Task 2 exports them).
  Tasks 3-4 produce the backend functions that get adapted into
  `RagSearchFn`/`MemorySearchFn`-shaped closures in Task 5 — this task does not
  depend on Tasks 3-4.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-core/src/deep-research.test.ts` with this content:

```ts
import { describe, expect, it } from "bun:test"
import {
  createDeepResearchTool,
  type CreateDeepResearchToolOptions,
} from "./deep-research.js"
import type { RunAgentLoopOptions } from "./agent.js"

const fakeRegistry = {} as CreateDeepResearchToolOptions["registry"]
const ragSearch: CreateDeepResearchToolOptions["ragSearch"] = async () => []
const memorySearch: CreateDeepResearchToolOptions["memorySearch"] =
  async () => []
const webSearch: CreateDeepResearchToolOptions["webSearch"] = async () => ({
  answer: "",
  citations: [],
})

describe("createDeepResearchTool", () => {
  it("returns a tool with the correct shape", () => {
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      runLoop: async () => "",
    })
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("cited")
    expect(t.parameters).toBeDefined()
  })

  it("calls the sub-loop with the question as text and rag/memory/web tools, no delegate/deep_research", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "synthesized answer"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      model: "gpt-5.5",
      runLoop,
    })

    const result = await t.execute!(
      { question: "what changed in yomi memory this week" },
      {} as never,
    )

    expect(captured).not.toBeNull()
    expect(captured!.text).toBe("what changed in yomi memory this week")
    expect(captured!.registry).toBe(fakeRegistry)
    expect(captured!.model).toBe("gpt-5.5")
    expect(Object.keys(captured!.extraTools ?? {}).sort()).toEqual([
      "memory_search",
      "rag_search",
      "web_search",
    ])
    expect(result).toEqual({ result: "synthesized answer" })
  })

  it("bounds the sub-loop to a fixed budget larger than delegate's", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      runLoop,
    })

    await t.execute!({ question: "x" }, {} as never)

    expect(captured!.maxSteps).toBe(12)
    expect(captured!.maxOutputTokens).toBe(6144)
  })

  it("prepends citation instructions to the passed-through system prompt", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      system: "Today is Tuesday, in Asia/Kolkata.",
      runLoop,
    })

    await t.execute!({ question: "x" }, {} as never)

    expect(captured!.system).toContain("[source:")
    expect(captured!.system).toContain("[memory:")
    expect(captured!.system).toContain("Today is Tuesday, in Asia/Kolkata.")
  })

  it("passes signal and onUsage through to the sub-loop", async () => {
    const controller = new AbortController()
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const usageEvents: unknown[] = []
    const onUsage = (usage: unknown) => usageEvents.push(usage)
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      signal: controller.signal,
      onUsage,
      runLoop,
    })

    await t.execute!({ question: "x" }, {} as never)

    expect(captured!.signal).toBe(controller.signal)
    expect(captured!.onUsage).toBe(onUsage)
  })

  it("allows exactly 2 research calls per tool instance, then returns an error", async () => {
    let calls = 0
    const runLoop = async () => {
      calls++
      return `result ${calls}`
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      runLoop,
    })

    const r1 = await t.execute!({ question: "a" }, {} as never)
    const r2 = await t.execute!({ question: "b" }, {} as never)
    const r3 = await t.execute!({ question: "c" }, {} as never)

    expect(r1).toEqual({ result: "result 1" })
    expect(r2).toEqual({ result: "result 2" })
    expect(r3).toEqual({ error: "research limit (2 per turn) reached" })
    expect(calls).toBe(2)
  })

  it("constructing without a runLoop override does not throw (defaults to the real runAgentLoop)", () => {
    expect(() =>
      createDeepResearchTool({
        registry: fakeRegistry,
        ragSearch,
        memorySearch,
        webSearch,
      }),
    ).not.toThrow()
  })

  it("the rag_search tool calls the injected ragSearch callback", async () => {
    let calledArgs: [string, number] | null = null
    const spyRagSearch: CreateDeepResearchToolOptions["ragSearch"] = async (
      query,
      limit,
    ) => {
      calledArgs = [query, limit]
      return [{ sourceName: "Notes", title: "Notes", content: "hello" }]
    }
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch: spyRagSearch,
      memorySearch,
      webSearch,
      runLoop,
    })
    await t.execute!({ question: "x" }, {} as never)

    const ragTool = captured!.extraTools!["rag_search"] as {
      execute: (
        args: { query: string; limit?: number },
        ctx: never,
      ) => Promise<unknown>
    }
    const result = await ragTool.execute(
      { query: "editor config" },
      {} as never,
    )

    expect(calledArgs).toEqual(["editor config", 5])
    expect(result).toEqual([
      { sourceName: "Notes", title: "Notes", content: "hello" },
    ])
  })

  it("the memory_search tool calls the injected memorySearch callback", async () => {
    let calledArgs: [string, number] | null = null
    const spyMemorySearch: CreateDeepResearchToolOptions["memorySearch"] =
      async (query, limit) => {
        calledArgs = [query, limit]
        return []
      }
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch: spyMemorySearch,
      webSearch,
      runLoop,
    })
    await t.execute!({ question: "x" }, {} as never)

    const memTool = captured!.extraTools!["memory_search"] as {
      execute: (
        args: { query: string; limit?: number },
        ctx: never,
      ) => Promise<unknown>
    }
    await memTool.execute({ query: "editor preference", limit: 3 }, {} as never)

    expect(calledArgs).toEqual(["editor preference", 3])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate packages/agent-core/src/deep-research.test.ts`
Expected: FAIL — `deep-research.js` does not exist yet (module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/agent-core/src/deep-research.ts` with this content:

```ts
import { tool } from "ai"
import { z } from "zod"
import {
  runAgentLoop,
  type RunAgentLoopOptions,
  type UsageInfo,
} from "./agent.js"
import type { ConnectorRegistry } from "./connectors/registry.js"

// Fixed, non-configurable — more room than delegate's generic budget to cover
// 3 search tools x possible refinement + a synthesis pass. See design:
// docs/superpowers/specs/2026-08-02-deep-research-tool-design.md
const RESEARCH_MAX_STEPS = 12
const RESEARCH_MAX_OUTPUT_TOKENS = 6144
const MAX_RESEARCH_CALLS_PER_TURN = 2

const RESEARCH_SYSTEM_PREFIX =
  "You are researching a question using the rag_search, memory_search, and " +
  "web_search tools available to you. Cite every claim inline: RAG hits as " +
  "[source: <sourceName>], memory hits as [memory: <topic>], and rely on " +
  "web_search's own attached citations for web results. Search as many times " +
  "as needed to cover the question, then synthesize a single cited answer.\n\n"

export type RagSearchResult = {
  sourceName: string
  title: string
  content: string
}
export type RagSearchFn = (
  query: string,
  limit: number,
) => Promise<RagSearchResult[]>

export type MemorySearchResult = {
  kind: string
  topic: string
  content: string
  sourcePath: string | null
  isStatic: boolean
  updatedAt: string | Date
  score: number
  matchedBy: string[]
}
export type MemorySearchFn = (
  query: string,
  limit: number,
) => Promise<MemorySearchResult[]>

export type WebSearchResultLike = {
  answer: string
  citations: { title: string; url: string }[]
}

export type DeepResearchRunLoopFn = (
  opts: RunAgentLoopOptions,
) => Promise<string>

const DEFAULT_RAG_LIMIT = 5
const DEFAULT_MEMORY_LIMIT = 8

function createRagSearchTool(search: RagSearchFn) {
  return tool({
    description:
      "Search the user's indexed RAG documents for relevant passages.",
    parameters: z.object({
      query: z.string().min(1).max(500).describe("Search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Max results (default 5)"),
    }),
    execute: async ({ query, limit }) =>
      search(query, limit ?? DEFAULT_RAG_LIMIT),
  })
}

function createMemorySearchTool(search: MemorySearchFn) {
  return tool({
    description:
      "Search the user's stored memory for relevant facts, preferences, and context.",
    parameters: z.object({
      query: z.string().min(1).max(500).describe("Search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max results (default 8)"),
    }),
    execute: async ({ query, limit }) =>
      search(query, limit ?? DEFAULT_MEMORY_LIMIT),
  })
}

function createResearchWebSearchTool(
  search: (query: string) => Promise<WebSearchResultLike>,
) {
  return tool({
    description:
      "Search the live web for current information relevant to the research question.",
    parameters: z.object({
      query: z
        .string()
        .min(1)
        .max(500)
        .describe("Natural-language search query"),
    }),
    execute: async ({ query }) => search(query),
  })
}

export interface CreateDeepResearchToolOptions {
  registry: ConnectorRegistry
  ragSearch: RagSearchFn
  memorySearch: MemorySearchFn
  webSearch: (query: string) => Promise<WebSearchResultLike>
  model?: string
  system?: string
  signal?: AbortSignal
  onUsage?: (usage: UsageInfo) => void
  // Test-only override — production callers omit this and get the real runAgentLoop.
  // Same reason as delegate.ts: packages/agent-core's test script has no --isolate,
  // so mock.module-faking a sibling file would leak across test files in the package.
  runLoop?: DeepResearchRunLoopFn
}

// Depth is capped at 1 by construction: the sub-loop's extraTools below never
// includes delegate or deep_research, so a research sub-agent can never itself
// delegate or recurse into another research call.
export function createDeepResearchTool(opts: CreateDeepResearchToolOptions) {
  const runLoop = opts.runLoop ?? runAgentLoop
  let calls = 0
  return tool({
    description:
      "Research a question thoroughly using indexed documents (RAG), stored " +
      "memory, and the live web. Use this for questions that need synthesis " +
      "across multiple sources, not a single quick lookup. Returns a synthesized " +
      "answer with inline cited sources.",
    parameters: z.object({
      question: z.string().min(1).max(2000).describe("The research question"),
    }),
    execute: async ({ question }) => {
      if (calls >= MAX_RESEARCH_CALLS_PER_TURN) {
        return {
          error: `research limit (${MAX_RESEARCH_CALLS_PER_TURN} per turn) reached`,
        }
      }
      calls++
      const result = await runLoop({
        registry: opts.registry,
        text: question,
        model: opts.model,
        system: RESEARCH_SYSTEM_PREFIX + (opts.system ?? ""),
        extraTools: {
          rag_search: createRagSearchTool(opts.ragSearch),
          memory_search: createMemorySearchTool(opts.memorySearch),
          web_search: createResearchWebSearchTool(opts.webSearch),
        },
        maxSteps: RESEARCH_MAX_STEPS,
        maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
        signal: opts.signal,
        onUsage: opts.onUsage,
      })
      return { result }
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate packages/agent-core/src/deep-research.test.ts`
Expected: PASS — 10 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/deep-research.ts packages/agent-core/src/deep-research.test.ts
git commit -m "feat(agent-core): add bounded deep-research tool"
```

---

### Task 2: Export from agent-core's public API

**Files:**

- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**

- Consumes: `createDeepResearchTool`, `CreateDeepResearchToolOptions`,
  `RagSearchResult`, `RagSearchFn`, `MemorySearchResult`, `MemorySearchFn`,
  `DeepResearchRunLoopFn`, `WebSearchResultLike` from `./deep-research.js` (Task
  1).
- Produces: `@yomi/agent-core` now exports `createDeepResearchTool` — Task 5
  imports it from there.

- [ ] **Step 1: Add the export**

In `packages/agent-core/src/index.ts`, immediately after the existing block:

```ts
export {
  createDelegateTool,
  type CreateDelegateToolOptions,
  type DelegateRunLoopFn,
} from "./delegate.js"
```

add:

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

- [ ] **Step 2: Typecheck the package**

Run: `bun run typecheck` Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-core/src/index.ts
git commit -m "feat(agent-core): export createDeepResearchTool"
```

---

### Task 3: `searchRagDocuments` backend query function

**Files:**

- Create: `apps/backend/src/services/rag/search.ts`
- Create: `apps/backend/src/services/rag/search.test.ts`

**Interfaces:**

- Consumes: `db`, `ragSources` from `@yomi/db`; `sql` from `drizzle-orm`.
- Produces:

  ```ts
  export type RagSearchResult = {
    sourceName: string
    title: string
    content: string
  }
  export async function searchRagDocuments(
    userId: string,
    query: string,
    limit: number,
  ): Promise<RagSearchResult[]>
  ```

  Task 5 consumes `searchRagDocuments` by this exact name, importing it from
  `../services/rag/search.js`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/services/rag/search.test.ts` with this content:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

type SqlCall = { text: string; values: unknown[] }

let sqlCalls: SqlCall[] = []
let executeRows: unknown[] = []
let executeFails = false

mock.module("drizzle-orm", () => ({
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
  ragSources: { __name: "rag_sources" },
}))

const { searchRagDocuments } = await import("./search.js")

function row(
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    sourceName: "Notes",
    title: "Notes",
    content: "some content",
    ...over,
  }
}

beforeEach(() => {
  sqlCalls = []
  executeRows = []
  executeFails = false
})

describe("searchRagDocuments", () => {
  it("returns rows from the query", async () => {
    executeRows = [row({ sourceName: "Docs", title: "API", content: "hello" })]

    const rows = await searchRagDocuments("u1", "hello", 5)

    expect(rows).toEqual([
      { sourceName: "Docs", title: "API", content: "hello" },
    ])
  })

  it("restricts to the caller's ready/active/backfilling chunks", async () => {
    await searchRagDocuments("u1", "hello", 5)

    const query = sqlCalls.at(-1)!
    expect(query.values).toContain("u1")
    expect(query.text).toContain("status in")
  })

  it("passes the limit through to the query", async () => {
    await searchRagDocuments("u1", "hello", 8)

    expect(sqlCalls.at(-1)!.values).toContain(8)
  })

  it("returns no rows for an empty query", async () => {
    expect(await searchRagDocuments("u1", "   ", 5)).toEqual([])
    expect(sqlCalls).toEqual([])
  })

  it("returns no rows when the query fails, rather than throwing", async () => {
    executeFails = true

    expect(await searchRagDocuments("u1", "hello", 5)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/services/rag/search.test.ts` Expected:
FAIL — `search.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/backend/src/services/rag/search.ts` with this content:

```ts
import { sql } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"

export type RagSearchResult = {
  sourceName: string
  title: string
  content: string
}

// Same FTS query fetchRagContext (apps/backend/src/agent/run.ts) uses for passive
// injection, factored out so it can also back the actively-callable rag_search tool.
export async function searchRagDocuments(
  userId: string,
  query: string,
  limit: number,
): Promise<RagSearchResult[]> {
  try {
    const safe = query.trim().slice(0, 500)
    if (!safe) return []
    const result = await db.execute(sql`
      select s.name as "sourceName", d.title as "title", c.content as "content"
      from rag_chunks c
      join rag_documents d on d.id = c.document_id
      join ${ragSources} s on s.id = d.source_id
      where c.user_id = ${userId}
        and s.status in ('ready', 'active', 'backfilling')
        and c.content_tsv @@ websearch_to_tsquery('english', ${safe})
      order by ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', ${safe})) desc
      limit ${limit}
    `)
    const rows = (
      Array.isArray(result)
        ? result
        : ((result as { rows?: unknown[] }).rows ?? [])
    ) as RagSearchResult[]
    return rows
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/rag/search.test.ts` Expected:
PASS — 5 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/rag/search.ts apps/backend/src/services/rag/search.test.ts
git commit -m "feat(rag): add searchRagDocuments query function"
```

---

### Task 4: `searchMemoryEntries` backend query function

**Files:**

- Modify: `apps/backend/src/services/memory/search.ts` (append)
- Modify: `apps/backend/src/services/memory/search.test.ts` (convert to dynamic
  import, append tests)

**Interfaces:**

- Consumes: `buildRecallCte`, `memorySearchKnobs`, `AGENT_META_COLUMNS` (all
  already exported from this file); `embedMemoryText` from `./embeddings.js`;
  `db` from `@yomi/db`.
- Produces:

  ```ts
  export type MemorySearchRow = {
    kind: string
    topic: string
    content: string
    sourcePath: string | null
    isStatic: boolean
    updatedAt: string | Date
    score: number
    matchedBy: string[]
  }
  export async function searchMemoryEntries(
    userId: string,
    query: string,
    limit: number,
  ): Promise<MemorySearchRow[]>
  ```

  Task 5 consumes `searchMemoryEntries` by this exact name, importing it from
  `../services/memory/search.js` (added to the existing import line that already
  pulls `AGENT_META_COLUMNS`, `buildRecallCte`, `memorySearchKnobs` from there).

- [ ] **Step 1: Write the failing tests**

Read the current `apps/backend/src/services/memory/search.test.ts` first — it
currently starts with:

```ts
import { describe, it, expect, afterEach } from "bun:test"
import type { SQL } from "drizzle-orm"

import { buildRecallCte, memorySearchKnobs } from "./search.js"
```

Replace those first four lines with:

```ts
import { beforeEach, describe, it, expect, afterEach, mock } from "bun:test"
import type { SQL } from "drizzle-orm"

let executeRows: unknown[] = []
let executedStatements: unknown[] = []
let executeFails = false

mock.module("@yomi/db", () => ({
  db: {
    execute: async (statement: unknown) => {
      executedStatements.push(statement)
      if (executeFails) throw new Error("query failed")
      return { rows: executeRows }
    },
  },
}))

const { buildRecallCte, memorySearchKnobs, searchMemoryEntries } =
  await import("./search.js")

beforeEach(() => {
  executeRows = []
  executedStatements = []
  executeFails = false
  delete process.env["OPENAI_API_KEY"]
})
```

Leave everything else in the file (the `numbersIn`/`textIn` helpers,
`restoreEnv`, the existing `describe("memorySearchKnobs", ...)` block, and any
`describe("buildRecallCte", ...)` block) exactly as it is — this change only
swaps the static import for a dynamic one (so the `@yomi/db` mock is registered
before `search.js` loads) and adds the mock/state needed for the new tests
below. The existing tests for `buildRecallCte`/`memorySearchKnobs` don't touch
`@yomi/db` at all, so they are unaffected by this change.

Append this new `describe` block at the end of the file:

```ts
describe("searchMemoryEntries", () => {
  it("passes the limit through as the fused-CTE candidate count and the final limit", async () => {
    await searchMemoryEntries("u1", "editor", 12)

    const numbers: number[] = []
    const walk = (chunks: unknown[]) => {
      for (const chunk of chunks) {
        if (typeof chunk === "number") numbers.push(chunk)
        else if (chunk && typeof chunk === "object" && "queryChunks" in chunk) {
          walk((chunk as { queryChunks: unknown[] }).queryChunks)
        }
      }
    }
    for (const statement of executedStatements) {
      if (
        statement &&
        typeof statement === "object" &&
        "queryChunks" in statement
      ) {
        walk((statement as { queryChunks: unknown[] }).queryChunks)
      }
    }
    expect(numbers).toContain(12)
  })

  it("returns the rows the query produces", async () => {
    executeRows = [
      {
        kind: "preference",
        topic: "editor",
        content: "uses vim",
        sourcePath: null,
        isStatic: false,
        updatedAt: "2026-07-01T00:00:00Z",
        score: 0.9,
        matchedBy: ["full_text"],
      },
    ]

    const rows = await searchMemoryEntries("u1", "editor", 8)

    expect(rows).toEqual(executeRows)
  })

  it("returns no rows for an empty query", async () => {
    expect(await searchMemoryEntries("u1", "   ", 8)).toEqual([])
    expect(executedStatements).toEqual([])
  })

  it("returns no rows when the query fails, rather than throwing", async () => {
    executeFails = true

    expect(await searchMemoryEntries("u1", "editor", 8)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/backend/src/services/memory/search.test.ts`
Expected: FAIL — `searchMemoryEntries` is not exported yet from `search.js`.

- [ ] **Step 3: Write the minimal implementation**

Append to `apps/backend/src/services/memory/search.ts`. First change the top
import line from:

```ts
import { sql, type SQL } from "drizzle-orm"

import { memoryVectorLiteral } from "./embeddings.js"
```

to:

```ts
import { sql, type SQL } from "drizzle-orm"
import { db } from "@yomi/db"

import { embedMemoryText, memoryVectorLiteral } from "./embeddings.js"
```

Then append this to the end of the file:

```ts
export type MemorySearchRow = {
  kind: string
  topic: string
  content: string
  sourcePath: string | null
  isStatic: boolean
  updatedAt: string | Date
  score: number
  matchedBy: string[]
}

// Same hybrid vector+FTS+metadata query fetchMemoryContext (apps/backend/src/agent/run.ts)
// uses for passive injection, factored out so it can also back the actively-callable
// memory_search tool.
export async function searchMemoryEntries(
  userId: string,
  query: string,
  limit: number,
): Promise<MemorySearchRow[]> {
  try {
    const safe = query.trim().slice(0, 400)
    if (!safe) return []

    const queryEmbedding = await embedMemoryText(safe).catch(() => [])
    const recallCte = buildRecallCte({
      userId,
      query: safe,
      queryEmbedding,
      knobs: memorySearchKnobs(),
      fusedLimit: limit,
      metaColumns: AGENT_META_COLUMNS,
    })

    const result = await db.execute(sql`
      ${recallCte}
      select
        e.kind as "kind",
        e.topic as "topic",
        e.content as "content",
        e.source_path as "sourcePath",
        e.is_static as "isStatic",
        e.updated_at as "updatedAt",
        f.score as "score",
        f.matched_by as "matchedBy"
      from fused f
      join memory_entries e on e.id = f.memory_id
      order by e.is_static desc, f.score desc, e.confidence desc, e.updated_at desc
      limit ${limit}
    `)
    const rows = ((result as unknown as { rows?: MemorySearchRow[] }).rows ??
      []) as MemorySearchRow[]
    return rows
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/backend/src/services/memory/search.test.ts`
Expected: PASS — all existing tests plus the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/memory/search.ts apps/backend/src/services/memory/search.test.ts
git commit -m "feat(memory): add searchMemoryEntries query function"
```

---

### Task 5: Wire `deep_research` into the backend agent

**Files:**

- Modify: `apps/backend/src/agent/run.ts` — import block (~lines 1-19);
  `fetchRagContext` (~lines 92-125); `fetchMemoryContext` (~lines 130-187); tool
  construction (~lines 549-607).
- Modify: `apps/backend/src/agent/run.test.ts`

**Interfaces:**

- Consumes: `createDeepResearchTool` from `@yomi/agent-core` (Task 2);
  `searchRagDocuments` from `../services/rag/search.js` (Task 3);
  `searchMemoryEntries` from `../services/memory/search.js` (Task 4). The
  existing in-scope `registry`, `agentModel`, `agentSystem`, `usageEventId`,
  `startedAt`, `opts.userId`, `opts.signal` (all already used by the
  `delegateTool` construction directly above where `deepResearchTool` will be
  added).
- Produces: nothing new for later tasks — this is the final integration point.

- [ ] **Step 1: Write the failing test**

In `apps/backend/src/agent/run.test.ts`, find the existing test (added when
`delegate` was wired):

```ts
it("wires a delegate tool into extraTools", async () => {
  mockUser = makeUser()
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  const delegateTool = lastAgentExtraTools!["delegate"] as {
    execute?: unknown
    description?: string
  }
  expect(typeof delegateTool.execute).toBe("function")
  expect(delegateTool.description).toContain("sub-agent")
})
```

Add a new test immediately after it:

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

- [ ] **Step 2: Run the test to verify it fails**

Run:
`bun test --isolate apps/backend/src/agent/run.test.ts -t "wires a deep_research tool"`
Expected: FAIL — `lastAgentExtraTools!["deep_research"]` is `undefined`.

- [ ] **Step 3: Add the imports**

In `apps/backend/src/agent/run.ts`, the import block currently reads:

```ts
import {
  ConnectorRegistry,
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

Change it to:

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

Then find this line (part of a multi-import from the memory search service):

```ts
import {
  AGENT_META_COLUMNS,
  buildRecallCte,
  memorySearchKnobs,
} from "../services/memory/search.js"
```

Change it to:

```ts
import {
  AGENT_META_COLUMNS,
  buildRecallCte,
  memorySearchKnobs,
  searchMemoryEntries,
} from "../services/memory/search.js"
```

Then find this line:

```ts
import { embedMemoryText } from "../services/memory/embeddings.js"
```

Add a new import immediately after it:

```ts
import { embedMemoryText } from "../services/memory/embeddings.js"
import { searchRagDocuments } from "../services/rag/search.js"
```

- [ ] **Step 4: Refactor `fetchRagContext` to call `searchRagDocuments`**

Find the current `fetchRagContext` function:

```ts
async function fetchRagContext(
  userId: string,
  query: string,
  maxChars = 3000,
): Promise<string> {
  try {
    const safe = query.trim().slice(0, 500)
    if (!safe) return ""
    type Row = { sourceName: string; title: string; content: string }
    const result = await db.execute(sql`
      select s.name as "sourceName", d.title as "title", c.content as "content"
      from rag_chunks c
      join rag_documents d on d.id = c.document_id
      join ${ragSources} s on s.id = d.source_id
      where c.user_id = ${userId}
        and s.status in ('ready', 'active', 'backfilling')
        and c.content_tsv @@ websearch_to_tsquery('english', ${safe})
      order by ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', ${safe})) desc
      limit 5
    `)
    const rows = (
      Array.isArray(result)
        ? result
        : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Row[]
    if (!rows.length) return ""
    const blocks: string[] = []
    let used = 0
    for (const [i, row] of rows.entries()) {
      const header = `[${i + 1}] ${row.sourceName}${row.title && row.title !== row.sourceName ? `: ${row.title}` : ""}`
      const block = `${header}\n${row.content}`
      if (used + block.length > maxChars) break
      blocks.push(block)
      used += block.length
    }
    return blocks.join("\n\n")
  } catch {
    return ""
  }
}
```

Replace it with:

```ts
async function fetchRagContext(
  userId: string,
  query: string,
  maxChars = 3000,
): Promise<string> {
  const rows = await searchRagDocuments(userId, query, 5)
  if (!rows.length) return ""
  const blocks: string[] = []
  let used = 0
  for (const [i, row] of rows.entries()) {
    const header = `[${i + 1}] ${row.sourceName}${row.title && row.title !== row.sourceName ? `: ${row.title}` : ""}`
    const block = `${header}\n${row.content}`
    if (used + block.length > maxChars) break
    blocks.push(block)
    used += block.length
  }
  return blocks.join("\n\n")
}
```

(`searchRagDocuments` already degrades to `[]` on failure or empty query, so the
`try/catch` that used to guard this whole function is no longer needed here —
`rows.length === 0` covers both cases identically to before.)

- [ ] **Step 5: Refactor `fetchMemoryContext` to call `searchMemoryEntries`**

Find the current `fetchMemoryContext` function:

```ts
async function fetchMemoryContext(
  userId: string,
  query: string,
  maxChars = 2000,
): Promise<string> {
  try {
    const safe = query.trim().slice(0, 400)
    if (!safe) return ""

    const queryEmbedding = await embedMemoryText(safe).catch(() => [])
    const recallCte = buildRecallCte({
      userId,
      query: safe,
      queryEmbedding,
      knobs: memorySearchKnobs(),
      fusedLimit: AGENT_RECALL_LIMIT,
      metaColumns: AGENT_META_COLUMNS,
    })

    const result = await db.execute(sql`
      ${recallCte}
      select
        e.kind as "kind",
        e.topic as "topic",
        e.content as "content",
        e.source_path as "sourcePath",
        e.is_static as "isStatic",
        e.updated_at as "updatedAt",
        f.score as "score",
        f.matched_by as "matchedBy"
      from fused f
      join memory_entries e on e.id = f.memory_id
      order by e.is_static desc, f.score desc, e.confidence desc, e.updated_at desc
      limit ${AGENT_RECALL_LIMIT}
    `)
    type Row = {
      kind: string
      topic: string
      content: string
      sourcePath: string | null
      isStatic: boolean
      updatedAt: string | Date
      score: number
      matchedBy: string[]
    }
    const rows = ((result as unknown as { rows?: Row[] }).rows ?? []) as Row[]
    if (!rows.length) return ""

    const out: string[] = []
    let used = 0
    const now = new Date()
    for (const row of rows) {
      const snippet = formatMemorySnippet(row, now)
      if (used + snippet.length > maxChars) break
      out.push(snippet)
      used += snippet.length
    }
    return out.join("\n")
  } catch {
    return ""
  }
}
```

Replace it with:

```ts
async function fetchMemoryContext(
  userId: string,
  query: string,
  maxChars = 2000,
): Promise<string> {
  const rows = await searchMemoryEntries(userId, query, AGENT_RECALL_LIMIT)
  if (!rows.length) return ""

  const out: string[] = []
  let used = 0
  const now = new Date()
  for (const row of rows) {
    const snippet = formatMemorySnippet(row, now)
    if (used + snippet.length > maxChars) break
    out.push(snippet)
    used += snippet.length
  }
  return out.join("\n")
}
```

Note: `searchMemoryEntries` returns `[]` for both an empty query and a failed
query (matching the original try/catch's behavior), and `AGENT_RECALL_LIMIT`
(the existing module-level constant) is passed as the limit — unchanged from
before.

- [ ] **Step 6: Construct `deepResearchTool` and add it to `extraTools`**

Find the `delegateTool` construction block (this exists already from item 6):

```ts
  const delegateTool = createDelegateTool({
    registry,
    model: agentModel,
    system: agentSystem,
    signal: opts.signal,
    // A separate handler from the parent's onUsage below: the parent's does a
    // db.update keyed by this turn's single usageEventId row, and a delegated
    // sub-loop call must never clobber the parent's own totals in that row.
    // This only records telemetry, tagged with a distinct route, so delegate
    // usage stays visible in ai_usage_events without last-write-wins damage.
    onUsage: (usage: UsageInfo) => {
      recordAiUsage({
        userId: opts.userId,
        requestId: crypto.randomUUID(),
        usageEventId: usageEventId ?? null,
        endpoint: "backend.agent",
        surface: "telegram",
        route: "agent.delegate",
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
        ...(reactionTool ? { react_to_message: reactionTool } : {}),
      },
```

Change it to (adding `researchRegistry`/`deepResearchTool` construction right
after `delegateTool`'s, and `deep_research` to the `extraTools` object):

```ts
  const delegateTool = createDelegateTool({
    registry,
    model: agentModel,
    system: agentSystem,
    signal: opts.signal,
    // A separate handler from the parent's onUsage below: the parent's does a
    // db.update keyed by this turn's single usageEventId row, and a delegated
    // sub-loop call must never clobber the parent's own totals in that row.
    // This only records telemetry, tagged with a distinct route, so delegate
    // usage stays visible in ai_usage_events without last-write-wins damage.
    onUsage: (usage: UsageInfo) => {
      recordAiUsage({
        userId: opts.userId,
        requestId: crypto.randomUUID(),
        usageEventId: usageEventId ?? null,
        endpoint: "backend.agent",
        surface: "telegram",
        route: "agent.delegate",
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        latencyMs: Date.now() - startedAt,
        status: "done",
      }).catch(() => {})
    },
  })
  // Never .init()'d, so its internal tool maps stay empty for the process's lifetime —
  // deep_research gets zero connector tools by construction, not by convention.
  // getAccessToken/listConnectedProviders are the only required deps and are never
  // actually called since init()/refresh() never run.
  const researchRegistry = new ConnectorRegistry({
    getAccessToken: async () => {
      throw new Error("research registry has no connected providers — never called")
    },
    listConnectedProviders: async () => [],
  })
  const deepResearchTool = createDeepResearchTool({
    registry: researchRegistry,
    ragSearch: (query, limit) => searchRagDocuments(opts.userId, query, limit),
    memorySearch: (query, limit) => searchMemoryEntries(opts.userId, query, limit),
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

- [ ] **Step 7: Run the full test file to verify everything passes**

Run: `bun test --isolate apps/backend/src/agent/run.test.ts` Expected: PASS —
all existing tests plus the new one.

- [ ] **Step 8: Typecheck and run the full backend + agent-core suites**

Run: `bun run typecheck` Expected: 0 errors.

Run: `bun test --isolate apps/backend/src` Expected: all pass.

Run: `bun test --isolate packages/agent-core/src` Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/agent/run.ts apps/backend/src/agent/run.test.ts
git commit -m "feat(agent): wire deep_research tool into the backend agent"
```

---

## Final Verification

- [ ] Run `bun run lint` (AGENTS.md: CI runs lint; it's part of the pre-push
      checklist).
- [ ] Run `bun run format:check` (CI's "PR quality" job runs
      `prettier --check .` and has failed on the last two plans in this session
      for unformatted new files — run `bun run format` if it fails, then
      re-verify tests still pass).
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate packages/agent-core/src` from repo root — all
      pass.
- [ ] Run `bun test --isolate apps/backend/src` from repo root — all pass.
- [ ] Re-read `docs/superpowers/specs/2026-08-02-deep-research-tool-design.md`
      and confirm every section (no connector access, new search tools,
      budget/cap, interface, wiring, error handling) has a corresponding
      implemented piece.
