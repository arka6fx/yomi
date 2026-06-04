# Spec 09 - Harness

## Purpose

Define prompt construction, context assembly, guardrails, hooks, and tool
wrapping. The harness lives in the sidecar and is the compilation layer that
turns user input, local memory, local RAG, and screen state into one model
prompt.

## Invariants

- System prompts are constructed dynamically.
- The fast path still makes exactly one answer-generation LLM call.
- Context retrieval happens before prompt construction, not through a fast-path
  tool loop.
- Structured personal memory is distinct from local RAG archive context.
- Local RAG failure is non-fatal; the sidecar falls back to structured local
  memory only.
- Agent tools remain available only on the agent path.

## Prompt Assembly

Fast and agent prompts share the same context sections, with different
capability declarations.

```ts
type PromptContext = {
  yomiMd?: string
  staticProfile?: string
  dynamicProfile?: string
  memorySummary?: string
  memoryIndex?: string
  localMemory?: string
  localRagContext?: string
  recentSession?: string
  hasScreen?: boolean
}
```

Rendered memory block:

```text
<memory>
<static_profile>...</static_profile>
<dynamic_profile>...</dynamic_profile>
<index>...</index>
<summary>...</summary>
<local_retrieved>...</local_retrieved>
<local_rag_context>...</local_rag_context>
<recent_chat>...</recent_chat>
</memory>
```

`<local_rag_context>` is included only when the local RAG index returns relevant
non-personal Yomi memory snippets.

## Context Builder

For Pro/Max fast turns, the sidecar loads context in parallel:

- `loadYomiMd()`
- `loadRichMemoryContext(userText)`
- `loadRecentSession()`
- local RAG retrieval over Yomi session, project, and non-profile memory files

`loadRichMemoryContext()` combines legacy `memory.md`/`memory-index.md` caps
with local memory engine profiles, structured FTS retrieval, and local RAG
archive retrieval.

## Auto Memory

Memory write is currently performed after successful Pro/Max turns in the fast
and agent pipelines:

- fast path appends a session turn, then calls `captureTurnMemory`.
- agent path appends a session summary and can compact session context.

`captureTurnMemory` extracts durable structured memories using the configured
extraction model. It stores only sanitized text memories in the local SQLite
database.

## Tool Hooks

Agent tools are wrapped with `PreToolUse` and `PostToolUse` hooks:

- `PreToolUse` can deny unsafe tool calls.
- `PostToolUse` can trim or log results.
- `Stop` records end-of-run summary.

Fast path does not expose a tool-selection loop.

## Guardrails

| Guardrail              | Behavior                                                             |
| ---------------------- | -------------------------------------------------------------------- |
| Missing screen context | Answer from knowledge and do not reference a screen.                 |
| Screenshot attached    | Use it only for screen-aware queries.                                |
| Local RAG unavailable  | Continue without local RAG.                                          |
| Uncertain memory       | Prefer omitting or marking uncertain over overwriting active memory. |
| Destructive agent tool | Deny or require confirmation.                                        |

## Implemented Files

- `apps/sidecar/src/harness/prompt.ts`
- `apps/sidecar/src/harness/hooks.ts`
- `apps/sidecar/src/harness/guards.ts`
- `apps/sidecar/src/pipeline/fast.ts`
- `apps/sidecar/src/pipeline/agent.ts`
- `apps/sidecar/src/memory/engine.ts`
- `apps/sidecar/src/memory/local-rag.ts`
