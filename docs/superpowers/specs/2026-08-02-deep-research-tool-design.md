# Deep-research tool — design

Status: approved Date: 2026-08-02 Backlog ref: `docs/agentic-backlog.md` item 5

## Problem

RAG and memory context are only ever injected passively into the system prompt
once per turn (`fetchRagContext`/`fetchMemoryContext` in
`apps/backend/src/agent/run.ts`, top-5 FTS/hybrid results, hardcoded). There is
no way for the agent to actively search RAG or memory more than once, refine a
query, or synthesize an answer with citations across RAG + memory + web in one
focused pass. `web_search` already exists as a top-level `extraTool`, but
nothing composes it with RAG/memory into a real research loop.

## Goal

A `deep_research` tool the top-level agent can call to hand a research question
to an isolated, bounded sub-loop that can call `rag_search`, `memory_search`,
and `web_search` repeatedly, then synthesize a cited answer — without ballooning
the parent's own transcript or budget.

## Non-goals

- New passive-injection behavior. `fetchRagContext`/`fetchMemoryContext` keep
  working exactly as today for every turn; this item adds **actively callable**
  search tools scoped to the research sub-loop only.
- Structured citation objects. Citations are inline bracketed markers in the
  synthesized prose (`[source: ...]`, `[memory: ...]`, plus whatever
  `web_search` already attaches), not a separate JSON citation array.
- Parallel research (multiple simultaneous sub-loops). Sequential only, same
  reasoning as `delegate` (item 6).

## Relationship to `delegate` (item 6)

Same shape — a bounded, isolated `runAgentLoop` sub-call, invoked as a top-level
`extraTool` — but purpose-built rather than generic:

|              | `delegate`                                                | `deep_research`                                                                                          |
| ------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Tool surface | Parent's full `ConnectorRegistry` (Gmail, Calendar, etc.) | `rag_search`, `memory_search`, `web_search` only — **no** connector registry access                      |
| Task input   | Free-form self-contained sub-task                         | A research question                                                                                      |
| Budget       | `maxSteps: 8`, `maxOutputTokens: 4096`                    | `maxSteps: 12`, `maxOutputTokens: 6144` (more room for 3 search tools × possible refinement + synthesis) |
| Per-turn cap | 3                                                         | 2 (heavier operation than a generic sub-task)                                                            |

This design applies the two lessons item 6's final review surfaced **from the
start**, not as a bolt-on fix: `onUsage` and `system` are part of the interface
from day one (see Interface below), not added after telemetry/timezone gaps are
found in review.

## No connector access

The sub-loop gets a second `ConnectorRegistry` instance that is deliberately
never `.init()`'d:

```ts
const researchRegistry = new ConnectorRegistry({
  getAccessToken: async () => null,
  listConnectedProviders: async () => [],
})
```

`getAccessToken`/`listConnectedProviders` are the only required constructor deps
(`ConnectorRegistryDeps` in `packages/agent-core/src/connectors/registry.ts`);
everything else is optional. Since `.init()`/`.refresh()` are never called, the
registry's internal tool maps stay empty for the lifetime of the process, so
`resolveConnectorTools` naturally contributes zero connector tools — enforced
structurally, the same way `delegate`'s recursion bound is structural rather
than conventional.

## New callable search tools

Following the existing `createRecallTool`/`createWebSearchTool` shape
(agent-core factory takes an injected search callback; the backend supplies the
real DB-backed implementation) — **not** DB access inside agent-core itself,
matching how `createRecallTool` never touches `@yomi/db` directly.

### `rag_search`

- **Backend function** (new): `searchRagDocuments(userId, query, limit)` in
  `apps/backend/src/agent/run.ts`, factored out of the existing
  `fetchRagContext`'s FTS query (same `rag_chunks`/`rag_documents`/`ragSources`
  join, same `websearch_to_tsquery` ranking), parameterized by `limit` (default
  5, max 10) instead of the hardcoded `limit 5`. Returns
  `{ sourceName: string; title: string; content: string }[]` instead of a
  pre-formatted text blob.
- `fetchRagContext` is refactored to call `searchRagDocuments` internally and
  keep its own text-formatting — no behavior change to passive injection.
- **Agent-core factory** (new, in `delegate`'s sibling file — see File
  Structure): `createRagSearchTool(search: RagSearchFn)`, where
  `RagSearchFn = (query: string, limit: number) => Promise<RagSearchResult[]>`.

### `memory_search`

- **Backend function** (new): `searchMemoryEntries(userId, query, limit)` in
  `apps/backend/src/agent/run.ts`, factored out of the existing
  `fetchMemoryContext`'s hybrid-search query (same `buildRecallCte` +
  `embedMemoryText` + `memory_entries` join already used there and by the MCP
  `memory_search` tool in `services/mcp-server.ts`), parameterized by `limit`
  (default 8, max 20) instead of the hardcoded `AGENT_RECALL_LIMIT`. Returns
  `{ kind: string; topic: string; content: string; updatedAt: string }[]`.
- `fetchMemoryContext` is refactored to call `searchMemoryEntries` internally —
  no behavior change to passive injection.
- **Agent-core factory**: `createMemorySearchTool(search: MemorySearchFn)`.

### `web_search`

Reused as-is — the sub-loop gets its own `createWebSearchTool(...)` instance
(same `searchWeb` function, same as the parent's), so its tool calls land in the
sub-loop's own transcript rather than the parent's.

These three tools exist **only** inside the research sub-loop's `extraTools` —
never added to the top-level agent's tool set.

## Budget and cap

- `maxSteps: 12`, `maxOutputTokens: 6144` — fixed, non-configurable constants in
  the new file (same pattern as `delegate`'s
  `DELEGATE_MAX_STEPS`/`DELEGATE_MAX_OUTPUT_TOKENS`).
- Per-turn cap: 2 calls per constructed tool instance. The 3rd+ call returns
  `{ error: "research limit (2 per turn) reached" }` without calling the
  sub-loop — same closure-counter pattern as `delegate`.

## Interface

New file: `packages/agent-core/src/deep-research.ts`.

```ts
// Same shape as delegate.ts's DelegateRunLoopFn (opts: RunAgentLoopOptions) => Promise<string>,
// defined fresh here rather than imported — this file's test-injection story is its own,
// not coupled to delegate.ts's naming.
export type DeepResearchRunLoopFn = (
  opts: RunAgentLoopOptions,
) => Promise<string>

export interface CreateDeepResearchToolOptions {
  registry: ConnectorRegistry // the never-.init()'d research registry, not the parent's
  ragSearch: RagSearchFn
  memorySearch: MemorySearchFn
  webSearch: WebSearchFn
  model?: string
  system?: string
  signal?: AbortSignal
  onUsage?: (usage: UsageInfo) => void
  // Test-only override — production callers omit this and get the real runAgentLoop.
  // Same reason as delegate.ts: packages/agent-core's test script has no --isolate,
  // so mock.module-faking a sibling file would leak across test files in the package.
  runLoop?: DeepResearchRunLoopFn
}

export function createDeepResearchTool(opts: CreateDeepResearchToolOptions) {
  const runLoop = opts.runLoop ?? runAgentLoop
  let calls = 0
  return tool({
    description:
      "Research a question thoroughly using indexed documents (RAG), stored " +
      "memory, and the live web. Use this for questions that need synthesis " +
      "across multiple sources, not a single quick lookup. Returns a synthesized " +
      "answer with inline source citations.",
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
          web_search: createWebSearchTool(opts.webSearch),
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

`RESEARCH_SYSTEM_PREFIX` is a constant instructing citation behavior: cite RAG
hits as `[source: <sourceName>]`, memory hits as `[memory: <topic>]`, and rely
on `web_search`'s own attached citations for web results — prepended to the
parent's already-built (timezone-aware) system prompt so the sub-loop keeps
correct date/timezone framing (the exact bug class item 6's final review caught
and fixed for `delegate`).

## Wiring

`apps/backend/src/agent/run.ts`, alongside where `delegateTool` is constructed
(after `agentSystem` is resolved): construct `researchRegistry`, the three
backend search callbacks, and `deepResearchTool`, then add
`deep_research: deepResearchTool` to the `extraTools` object passed to the
top-level `runAgentLoop` call.

`onUsage` for `deep_research` follows the exact pattern the `delegate` fix
established: a dedicated handler calling only
`recordAiUsage({ route: "agent.deep_research", ... })`, never the parent's
`db.update(usageEvents)` (which would clobber the parent turn's row).

## Error handling

- The sub-loop's own `runAgentLoop` call already degrades to a safe fallback
  string on internal failure (grace call, tool-result fallback, or `""`) — same
  as `delegate`, no additional try/catch needed in `execute`.
- Cap-exceeded returns `{ error }`, never throws — same as `delegate`.
- `rag_search`/`memory_search` backend functions each degrade to `[]` on a query
  failure (matching `fetchRagContext`/`fetchMemoryContext`'s existing
  try/catch-to-empty pattern), so a DB hiccup mid-research doesn't abort the
  whole sub-loop, just returns no results for that call.

## Testing

- `packages/agent-core/src/deep-research.test.ts`: mirrors `delegate.test.ts` —
  tool shape, sub-loop called with the question as `text`, the three search
  tools present in the sub-loop's `extraTools` (and `delegate`/`deep_research`
  absent — recursion bound), fixed budget (12/6144), signal/model/system/onUsage
  passthrough, cap boundary (2 succeed, 3rd errors).
- Backend: unit tests for `searchRagDocuments`/`searchMemoryEntries` (extracted
  query functions) verifying the `limit` parameter is honored and empty/failure
  cases degrade to `[]`; one wiring test in `run.test.ts` asserting
  `deep_research` appears in `extraTools` with a real `execute` function,
  mirroring the strengthened `delegate` wiring test.

## Open questions / deliberately deferred

- Whether 12 steps / 6144 tokens / cap 2 are right long-term — conservative
  starting point, revisit with real usage data (same framing as item 6).
- No dedicated UI/observability for how often research is invoked or hits its
  cap — same gap item 6's review flagged and deferred for `delegate`; a future
  item could add a shared counter/log for both bounded sub-loop tools at once
  rather than duplicating ad hoc per-tool logging.
