# Subagent Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `delegate` tool the backend agent can call to hand a
self-contained sub-task to an isolated, bounded `runAgentLoop` sub-call.

**Architecture:** One new agent-core file (`delegate.ts`) exporting a
`createDelegateTool` factory that closes over a per-turn call counter and a
(test-overridable) reference to `runAgentLoop`; wired into
`apps/backend/src/agent/run.ts`'s existing `extraTools` object alongside
`recall_past_conversations` and `web_search`.

**Tech Stack:** Bun, `ai` SDK's `tool()`/`zod`, TypeScript, `bun:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-subagent-delegation-design.md` — this
  plan implements it exactly; do not deviate without re-checking that file.
- Recursion bound: the sub-loop `runAgentLoop` call passes **no** `extraTools`
  field at all (not an empty object with `delegate` omitted — the field itself
  is absent), so a delegated sub-agent never has `delegate` in its tool set.
- Sub-loop budget is fixed and non-configurable: `maxSteps: 8`,
  `maxOutputTokens: 4096`.
- Sub-loop gets the same `registry` as the parent, the parent's resolved
  `model`, and the parent's `signal` — but **no** `history` (omitted, not empty
  array) and **no** `extraTools`.
- Per-turn cap: at most 3 `delegate` calls per constructed tool instance. The
  4th+ call returns `{ error: "delegation limit (3 per turn) reached" }` and
  does **not** call the sub-loop.
- Success returns `{ result: string }`; the cap-exceeded case returns
  `{ error: string }` — never throws.
- `packages/agent-core`'s `bun test` script has **no** `--isolate` flag (see
  `packages/agent-core/package.json`), and multiple `.test.ts` files in that
  package run in one shared process/module registry. **Do not** use
  `mock.module` to fake `./agent.js`'s `runAgentLoop` in this package's tests —
  it would leak into `agent.test.ts`, which tests the real `runAgentLoop`.
  Instead, `createDelegateTool` takes an optional, injectable `runLoop`
  parameter for tests (defaulting to the real `runAgentLoop` in production) —
  see Task 1.
- Conventional commit messages (`feat:`, `test:`), lowercase, no full stop, max
  72 chars, per `AGENTS.md`.
- Test commands, run from repo root:
  `bun test --isolate packages/agent-core/src/delegate.test.ts` for Task 1;
  `bun test --isolate apps/backend/src/agent/run.test.ts` for Task 2 (note:
  `apps/backend`'s test script _does_ use `--isolate` — only
  `packages/agent-core` lacks it).

---

## File Structure

- Create: `packages/agent-core/src/delegate.ts` — `createDelegateTool` factory,
  the recursion bound, the fixed budget, the per-turn cap.
- Create: `packages/agent-core/src/delegate.test.ts` — tests for all of the
  above.
- Modify: `packages/agent-core/src/index.ts` — export `createDelegateTool` and
  its types.
- Modify: `apps/backend/src/agent/run.ts` — construct the tool after
  `agentModel` is resolved (~line 555) and add it to the `extraTools` object
  passed to the top-level `runAgentLoop` call (~line 561-565).
- Modify: `apps/backend/src/agent/run.test.ts` — capture `extraTools` from the
  mocked `runAgentLoop` call and assert a `delegate` key is present.

---

### Task 1: `createDelegateTool` in agent-core

**Files:**

- Create: `packages/agent-core/src/delegate.ts`
- Create: `packages/agent-core/src/delegate.test.ts`

**Interfaces:**

- Consumes: `runAgentLoop` and `RunAgentLoopOptions` from `./agent.js` (already
  exist — `runAgentLoop(opts: RunAgentLoopOptions): Promise<string>`);
  `ConnectorRegistry` type from `./connectors/registry.js`.
- Produces:

  ```ts
  export type DelegateRunLoopFn = (opts: RunAgentLoopOptions) => Promise<string>
  export interface CreateDelegateToolOptions {
    registry: ConnectorRegistry
    model?: string
    signal?: AbortSignal
    runLoop?: DelegateRunLoopFn
  }
  export function createDelegateTool(opts: CreateDelegateToolOptions)
  ```

  Task 3 consumes `createDelegateTool` and `CreateDelegateToolOptions` by these
  exact names (imported via `@yomi/agent-core` after Task 2 exports them).

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-core/src/delegate.test.ts` with this content:

```ts
import { describe, expect, it } from "bun:test"
import {
  createDelegateTool,
  type CreateDelegateToolOptions,
} from "./delegate.js"
import type { RunAgentLoopOptions } from "./agent.js"

const fakeRegistry = {} as CreateDelegateToolOptions["registry"]

describe("createDelegateTool", () => {
  it("returns a tool with the correct shape", () => {
    const t = createDelegateTool({
      registry: fakeRegistry,
      runLoop: async () => "",
    })
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("sub-agent")
    expect(t.parameters).toBeDefined()
  })

  it("calls the sub-loop with the task as text, no history, no extraTools", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "sub-agent result"
    }
    const t = createDelegateTool({
      registry: fakeRegistry,
      model: "gpt-5.5",
      runLoop,
    })

    const result = await t.execute!({ task: "find the latest PR" }, {} as never)

    expect(captured).not.toBeNull()
    expect(captured!.text).toBe("find the latest PR")
    expect(captured!.history).toBeUndefined()
    expect(captured!.extraTools).toBeUndefined()
    expect(captured!.registry).toBe(fakeRegistry)
    expect(captured!.model).toBe("gpt-5.5")
    expect(result).toEqual({ result: "sub-agent result" })
  })

  it("bounds the sub-loop to a fixed small budget regardless of caller intent", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDelegateTool({ registry: fakeRegistry, runLoop })

    await t.execute!({ task: "x" }, {} as never)

    expect(captured!.maxSteps).toBe(8)
    expect(captured!.maxOutputTokens).toBe(4096)
  })

  it("passes the signal through to the sub-loop", async () => {
    const controller = new AbortController()
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDelegateTool({
      registry: fakeRegistry,
      signal: controller.signal,
      runLoop,
    })

    await t.execute!({ task: "x" }, {} as never)

    expect(captured!.signal).toBe(controller.signal)
  })

  it("allows exactly 3 delegations per tool instance, then returns an error", async () => {
    let calls = 0
    const runLoop = async () => {
      calls++
      return `result ${calls}`
    }
    const t = createDelegateTool({ registry: fakeRegistry, runLoop })

    const r1 = await t.execute!({ task: "a" }, {} as never)
    const r2 = await t.execute!({ task: "b" }, {} as never)
    const r3 = await t.execute!({ task: "c" }, {} as never)
    const r4 = await t.execute!({ task: "d" }, {} as never)

    expect(r1).toEqual({ result: "result 1" })
    expect(r2).toEqual({ result: "result 2" })
    expect(r3).toEqual({ result: "result 3" })
    expect(r4).toEqual({ error: "delegation limit (3 per turn) reached" })
    expect(calls).toBe(3)
  })

  it("does not call the sub-loop at all once the cap is reached", async () => {
    let calls = 0
    const runLoop = async () => {
      calls++
      return "x"
    }
    const t = createDelegateTool({ registry: fakeRegistry, runLoop })

    for (let i = 0; i < 5; i++)
      await t.execute!({ task: `task ${i}` }, {} as never)

    expect(calls).toBe(3)
  })

  it("constructing without a runLoop override does not throw (defaults to the real runAgentLoop)", () => {
    expect(() => createDelegateTool({ registry: fakeRegistry })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate packages/agent-core/src/delegate.test.ts` Expected:
FAIL — `delegate.js` does not exist yet (module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/agent-core/src/delegate.ts` with this content:

```ts
import { tool } from "ai"
import { z } from "zod"
import { runAgentLoop, type RunAgentLoopOptions } from "./agent.js"
import type { ConnectorRegistry } from "./connectors/registry.js"

// Fixed, small, and non-configurable — this sub-loop is meant to be cheap and
// bounded by construction, not tuned. See design:
// docs/superpowers/specs/2026-08-02-subagent-delegation-design.md
const DELEGATE_MAX_STEPS = 8
const DELEGATE_MAX_OUTPUT_TOKENS = 4096
const MAX_DELEGATIONS_PER_TURN = 3

export type DelegateRunLoopFn = (opts: RunAgentLoopOptions) => Promise<string>

export interface CreateDelegateToolOptions {
  registry: ConnectorRegistry
  model?: string
  signal?: AbortSignal
  // Test-only override — production callers omit this and get the real
  // runAgentLoop. Keeps this file's tests from needing to mock a sibling
  // module, which packages/agent-core's non-isolated test run can't do
  // safely (see agent.test.ts, which tests the real runAgentLoop).
  runLoop?: DelegateRunLoopFn
}

// Depth is capped at 1 by construction: the sub-loop call below never sets
// extraTools, so a delegated sub-agent can never itself call delegate.
export function createDelegateTool(opts: CreateDelegateToolOptions) {
  const runLoop = opts.runLoop ?? runAgentLoop
  let calls = 0
  return tool({
    description:
      "Delegate a well-defined, self-contained sub-task to an isolated sub-agent. " +
      "Use this to break a complex request into independent pieces, or to keep a " +
      "long research/lookup step out of your own transcript. The sub-agent has " +
      "access to the same connected services you do, but no memory of this " +
      "conversation — describe the task completely and self-contained.",
    parameters: z.object({
      task: z
        .string()
        .min(1)
        .max(2000)
        .describe("A complete, self-contained description of the sub-task"),
    }),
    execute: async ({ task }) => {
      if (calls >= MAX_DELEGATIONS_PER_TURN) {
        return {
          error: `delegation limit (${MAX_DELEGATIONS_PER_TURN} per turn) reached`,
        }
      }
      calls++
      const result = await runLoop({
        registry: opts.registry,
        text: task,
        model: opts.model,
        maxSteps: DELEGATE_MAX_STEPS,
        maxOutputTokens: DELEGATE_MAX_OUTPUT_TOKENS,
        signal: opts.signal,
      })
      return { result }
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate packages/agent-core/src/delegate.test.ts` Expected:
PASS — 7 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/delegate.ts packages/agent-core/src/delegate.test.ts
git commit -m "feat(agent-core): add bounded delegate tool for subagent calls"
```

---

### Task 2: Export from agent-core's public API

**Files:**

- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**

- Consumes: `createDelegateTool`, `CreateDelegateToolOptions`,
  `DelegateRunLoopFn` from `./delegate.js` (Task 1).
- Produces: `@yomi/agent-core` now exports `createDelegateTool` — Task 3 imports
  it from there, matching how it already imports
  `createRecallTool`/`createWebSearchTool`.

- [ ] **Step 1: Add the export**

In `packages/agent-core/src/index.ts`, immediately after the existing block:

```ts
export {
  createWebSearchTool,
  searchWeb,
  type WebSearchFn,
  type WebSearchResult,
  type WebSearchCitation,
} from "./web-search.js"
```

add:

```ts
export {
  createDelegateTool,
  type CreateDelegateToolOptions,
  type DelegateRunLoopFn,
} from "./delegate.js"
```

- [ ] **Step 2: Typecheck the package**

Run: `bun run typecheck` Expected: no errors (this surfaces any export/type
mismatch immediately, before Task 3 tries to consume it).

- [ ] **Step 3: Commit**

```bash
git add packages/agent-core/src/index.ts
git commit -m "feat(agent-core): export createDelegateTool"
```

---

### Task 3: Wire `delegate` into the backend agent

**Files:**

- Modify: `apps/backend/src/agent/run.ts:4-18` (import block),
  `apps/backend/src/agent/run.ts:555-565` (tool construction and `extraTools`)
- Modify: `apps/backend/src/agent/run.test.ts`

**Interfaces:**

- Consumes: `createDelegateTool` from `@yomi/agent-core` (Task 2). The existing
  in-scope `registry` (`ConnectorRegistry` instance, constructed at
  `run.ts:463`), `agentModel` (string, resolved at `run.ts:555`), and
  `opts.signal` (the `runAgent` function's own `AbortSignal | undefined`
  parameter).
- Produces: nothing new for later tasks — this is the final integration point
  for this plan.

- [ ] **Step 1: Add a capture variable and reset it in `beforeEach`**

In `apps/backend/src/agent/run.test.ts`, find this line near the top:

```ts
let lastAgentSystem: string | undefined
```

Change it to:

```ts
let lastAgentSystem: string | undefined
let lastAgentExtraTools: Record<string, unknown> | undefined
```

Find the mocked `runAgentLoop` in the same file:

```ts
  runAgentLoop: async (opts: {
    system?: string
    onUsage?: (usage: Record<string, unknown>) => void
  }) => {
    lastAgentSystem = opts.system
```

Change it to:

```ts
  runAgentLoop: async (opts: {
    system?: string
    extraTools?: Record<string, unknown>
    onUsage?: (usage: Record<string, unknown>) => void
  }) => {
    lastAgentSystem = opts.system
    lastAgentExtraTools = opts.extraTools
```

Find the `beforeEach` reset block containing `lastAgentSystem = undefined` and
add the new variable's reset immediately after it:

```ts
lastAgentSystem = undefined
lastAgentExtraTools = undefined
```

- [ ] **Step 2: Write the failing test**

Add this test to `apps/backend/src/agent/run.test.ts`, near the other tests that
call `runAgent` and assert on `lastAgentSystem` (e.g. next to "passes the agent
soul in the backend system prompt"):

```ts
it("wires a delegate tool into extraTools", async () => {
  mockUser = makeUser()
  const { runAgent } = await import("./run.js")
  await runAgent({ userId: "user_1", text: "hi" })
  expect(lastAgentExtraTools).toBeDefined()
  expect(lastAgentExtraTools!["delegate"]).toBeDefined()
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
`bun test --isolate apps/backend/src/agent/run.test.ts -t "wires a delegate tool"`
Expected: FAIL — `lastAgentExtraTools!["delegate"]` is `undefined`. The mock now
captures `extraTools`, but `run.ts` doesn't put a `delegate` key in it yet.

- [ ] **Step 4: Add the import**

In `apps/backend/src/agent/run.ts`, the import block currently reads:

```ts
import {
  ConnectorRegistry,
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

Change it to (adding `createDelegateTool` in alphabetical position among the
value imports):

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

- [ ] **Step 5: Construct the tool and add it to `extraTools`**

In the same file, find this existing block (around line 555-565):

```ts
  const agentModel = getPlan(effectivePlanForUser(user)).model
  try {
    text = await runAgentLoop({
      registry,
      text: opts.text,
      history,
      extraTools: {
        recall_past_conversations: recallTool,
        web_search: webSearchTool,
        ...(reactionTool ? { react_to_message: reactionTool } : {}),
      },
```

Change it to:

```ts
  const agentModel = getPlan(effectivePlanForUser(user)).model
  const delegateTool = createDelegateTool({ registry, model: agentModel, signal: opts.signal })
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

- [ ] **Step 6: Run the full test file to verify everything passes**

Run: `bun test --isolate apps/backend/src/agent/run.test.ts` Expected: PASS —
all existing tests plus the new one.

- [ ] **Step 7: Typecheck and run the full backend suite**

Run: `bun run typecheck` Expected: 0 errors.

Run: `bun test --isolate apps/backend/src` Expected: all pass — confirms the
wiring didn't break anything else.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/agent/run.ts apps/backend/src/agent/run.test.ts
git commit -m "feat(agent): wire delegate tool into the backend agent loop"
```

---

## Final Verification

- [ ] Run `bun run lint` (AGENTS.md: CI runs lint; it's part of the pre-push
      checklist).
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate packages/agent-core/src` from repo root — all
      pass, including `agent.test.ts` (confirms the non-isolated-package mocking
      concern from Global Constraints didn't cause cross-file pollution).
- [ ] Run `bun test --isolate apps/backend/src` from repo root — all pass.
- [ ] Re-read `docs/superpowers/specs/2026-08-02-subagent-delegation-design.md`
      and confirm every section (recursion bound, sub-loop scope, budget,
      per-turn cap, interface, wiring, error handling) has a corresponding
      implemented piece.
