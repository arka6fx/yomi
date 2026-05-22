# Spec 09 — Harness

## Purpose

Define the system prompt construction, guardrails, hooks, and notepad injection that wraps every LLM interaction. The harness lives in the sidecar and is the compilation layer that assembles the final system prompt for every turn.

## Invariants

- System prompt is always constructed dynamically — never a single static string.
- The harness runs once per turn, not per-LLM-call inside a turn.
- Guardrails are checked at the harness level, not per-tool-call.
- All hooks are synchronous and run in order. No hook may await an external resource.

## Detailed Design

### System prompt assembly

```typescript
function buildSystemPrompt(type: "fast" | "agent", userConfig: UserConfig): string {
  return [
    CORE_IDENTITY,          // "You are Yomi..."
    CAPABILITY_DECLARATION, // based on type: fast vs agent
    USER_PREFERENCES,       // from yomi.md
    MEMORY_SNIPPET,         // top N notepads from ~/.yomi/notepad/
    SCREEN_CONTEXT,         // if screenshot available
    TIME_CONTEXT,           // "Current time: ..."
    OUTPUT_FORMAT,          // fast: concise answer; agent: structured plan
    GUARDRAILS,             // "Say 'I don't know' if uncertain..."
    TOOL_DECLARATIONS,      // agent only
  ].filter(Boolean).join("\n\n")
}
```

### hooks.ts

Defines lifecycle hooks that run before and after LLM interactions. Hooks are used for observability, not for modifying behavior.

```typescript
type Hook = (turn: Turn) => void

const hooks: { beforeLlm: Hook[]; afterLlm: Hook[]; afterTool: Hook[] } = {
  beforeLlm: [logPrompt, checkBudget],
  afterLlm: [logResponse, checkToxicity, autoMemory],
  afterTool: [logToolResult, detectLoop],
}
```

### Auto-memory hook

After every agent turn, the `autoMemory` hook is called. It sends the last turn (user query + assistant response) to a small model (`gpt-4.1-mini`) to decide if anything should be persisted to memory:

```typescript
const decision = await generateObject({
  model: createModel(),
  schema: z.object({
    should_store: z.boolean(),
    content: z.string().max(200).optional(),
    key: z.string().max(40).optional(),
  }),
  prompt: `Does this interaction contain info worth remembering?\nUser: ${userText}\nAssistant: ${assistantText}`,
})
```

If `should_store`, it appends a new notepad entry to `~/.yomi/notepad/` and triggers compaction if > 100 entries.

### Guardrails

| Guardrail | Check | Action |
|---|---|---|
| Persona | Response mentions "I am an AI" or similar | Strip or rephrase |
| Uncertainty | Response starts with "I'm not sure" | Keep as-is (preferred) |
| Refusal | Response is a refusal | Reroute to fast pipeline for a simpler rephrasing attempt |
| Harmful content | Contains profanity or unsafe code | Block and return guardrail error SSE |
| User burden | Asks user for clarification | Let through (fallback to agent if fast refused) |

### Wiring

The harness is not a separate endpoint — it's a dependency used by both the fast pipeline and the agent pipeline:

- `fast.ts` calls `buildSystemPrompt("fast", userConfig)` at the top of `answerPipeline`.
- `agent.ts` calls `buildSystemPrompt("agent", userConfig)` at the top of the ReAct loop.
- `hooks.ts` is instantiated at pipeline start and runs automatically at each hook point.

## Files to create

- `apps/sidecar/src/harness/prompt.ts` — `buildSystemPrompt()` and all section generators (core, capability, user_prefs, memory, time, output_format, guardrails).
- `apps/sidecar/src/harness/guardrails.ts` — guardrail check functions.
- `apps/sidecar/src/harness/hooks.ts` — hook infrastructure + auto-memory hook.
- `apps/sidecar/src/harness/hooks.test.ts` — tests for auto-memory, checkBudget, detectLoop.
- `apps/sidecar/src/harness/guardrails.test.ts` — tests for guardrail functions.

## Open Questions

- Should guardrails also be checked in the main Yomi API proxy (backend)? → Phase 1. Harness covers sidecar flows.
