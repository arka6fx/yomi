# Subagent delegation on the backend agent — design

Status: approved
Date: 2026-08-02
Backlog ref: `docs/agentic-backlog.md` item 6

## Problem

`runAgentLoop` (`packages/agent-core/src/agent.ts`) is a single flat ReAct
loop over connector tools. There is no way for the agent to fan a
complex request out into an isolated sub-task with its own tool-calling
loop — every step happens in one continuous transcript, growing the prompt
and coupling unrelated work together. The backlog calls this "the hermes /
sidecar subagent pattern" and flags it as unblocking bigger, multi-step
tasks.

## Goal

A `delegate` tool the top-level agent can call to hand a well-defined,
self-contained sub-task to an isolated `runAgentLoop` invocation, get back a
synthesized result, and continue its own transcript — without the risk of
runaway recursion or unbounded extra compute that a naive implementation
would introduce.

## Non-goals

- Parallel/concurrent delegation (fan-out to multiple sub-agents at once).
  Each `delegate` call is a single, sequential, awaited sub-loop.
- Cross-turn or cross-session sub-agents. A delegated sub-loop lives and
  dies within the single top-level `runAgentLoop` call that spawned it.
- New billing primitives. Composio tool-call metering already wraps the
  shared registry's executor once per turn (see `composioMeter` in
  `apps/backend/src/agent/run.ts`), so sub-loop tool calls are metered for
  free by construction — this design relies on that, not a new mechanism.

## Recursion bound

Depth is hard-capped at 1, enforced structurally rather than by convention:
`createDelegateTool`'s sub-loop `runAgentLoop` call passes no `extraTools`,
so a delegated sub-agent never has `delegate` in its own tool set and
cannot itself delegate. This guarantee lives inside `delegate.ts` — any
future caller of `createDelegateTool` gets it automatically, it isn't
something each call site has to remember to uphold.

## Sub-loop scope

- **Registry:** the same `ConnectorRegistry` instance as the parent turn.
  This is what makes a delegated sub-task actually useful (it can read an
  email, check a calendar, etc. if the task needs it) and is also what
  makes Composio billing correct with zero extra code: the counting
  executor (`composioMeter`) is constructed once per top-level turn in
  `agent/run.ts` and wraps the registry's tool execution, so any Composio
  call the sub-loop makes through the shared registry increments the same
  counter the parent's calls do, and gets charged together at the end of
  the turn exactly as today.
- **History:** none. The sub-loop starts fresh with only the delegated
  `task` string as its `text` — not the parent's conversation history.
  This keeps the sub-agent's prompt small and its focus scoped to exactly
  what it was asked, rather than re-deriving context it doesn't need.

## Budget

Every delegated call runs with fixed, small defaults, independent of
whatever budget the parent turn has left:

- `maxSteps: 8`
- `maxOutputTokens: 4096`

These are local constants in `delegate.ts`, not environment-configurable —
matching the backlog's framing of this as a "bounded" sub-loop by
construction, not a tunable one.

## Per-turn delegation cap

A closure-scoped counter inside `createDelegateTool` allows at most 3
`delegate` calls within the lifetime of one constructed tool instance
(i.e., one top-level turn, since `agent/run.ts` constructs a fresh
`createDelegateTool(...)` per call to the outer `runAgentLoop`). This
bounds how much "free" extra LLM compute one turn can trigger — Composio
tool calls are metered automatically (see above), but the LLM calls
themselves are not separately charged beyond the turn's flat
`chargeUsage({ kind: "bot_message" })`, so without a cap a single turn
could fan out an unbounded number of 8-step sub-loops for the same flat
fee.

The 4th+ call in a turn does not throw — it returns
`{ error: "delegation limit (3 per turn) reached" }`, the same
degrade-gracefully-and-let-the-model-see-it pattern connector tools already
use for "not connected" and similar conditions, rather than hard-failing
the whole turn.

## Interface

New file: `packages/agent-core/src/delegate.ts`, following the existing
`createRecallTool` / `createWebSearchTool` factory shape (`tool()` from
`ai`, `zod` params) but taking loop-level dependencies instead of a plain
callback, since it needs to invoke `runAgentLoop` itself:

```ts
export interface CreateDelegateToolOptions {
  registry: ConnectorRegistry
  model?: string
  signal?: AbortSignal
}

export function createDelegateTool(opts: CreateDelegateToolOptions) {
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
        return { error: `delegation limit (${MAX_DELEGATIONS_PER_TURN} per turn) reached` }
      }
      calls++
      const result = await runAgentLoop({
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

## Wiring

`recallTool` / `webSearchTool` are constructed at `apps/backend/src/agent/run.ts:540-541`,
but the resolved agent model (`agentModel = getPlan(effectivePlanForUser(user)).model`,
line 555) isn't available until just before the `runAgentLoop` call itself
(line 556-557) — later than those two. `delegateTool` is constructed there,
right after `agentModel` is resolved and immediately before the
`runAgentLoop({...})` call, not grouped with the earlier two tools:

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
    // ...
    model: agentModel,
```

`agentModel` here is whatever model the parent turn resolved to (same
capability as the parent, not the cheap fast model) — a delegated sub-task
should not silently get a worse model than the conversation it's part of.

## Error handling

- The sub-loop's own `runAgentLoop` call already degrades to a safe fallback
  string on internal failure (existing behavior — grace call, tool-result
  fallback, or `""`), so `delegate`'s `execute` never needs its own
  try/catch beyond what `runAgentLoop` already guarantees.
- The only new failure mode this tool introduces is the per-turn cap, which
  is handled by returning `{ error }` rather than throwing (see above).

## Testing

New `packages/agent-core/src/delegate.test.ts`:

- Calling the tool invokes `runAgentLoop` with the task as `text`, no
  `history`, the fixed `maxSteps`/`maxOutputTokens`, and no `extraTools`
  (recursion-bound assertion).
- The registry and model passed to `createDelegateTool` are the ones
  `runAgentLoop` is called with.
- A 4th call within the same tool instance returns `{ error }` and does not
  call `runAgentLoop` again.
- The 3rd call still succeeds (boundary check on the cap).

## Open questions / deliberately deferred

- Whether 3 delegations / 8 steps / 4096 tokens are the right numbers long
  term. Chosen as conservative, cheap-to-reason-about defaults; revisit
  with real usage data once shipped.
- Parallel delegation (fan-out) is explicitly out of scope for this
  iteration — sequential-only keeps the recursion/budget/billing reasoning
  simple. A future item can revisit once there's a concrete multi-subtask
  use case that needs it.
