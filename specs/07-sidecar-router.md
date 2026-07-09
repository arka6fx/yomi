# Spec 07 — Sidecar: Intent Router

## Purpose

Define the intent router that classifies every user request as either `fast` or
`agent` at the start of every turn. The router is the first step inside the
sidecar for every query — it commits to a pipeline once, then hands off. It
exists so we never lose prompt-cache or thrash tool vocabularies by switching
models mid-turn.

## Invariants

- Runs at the START of every turn. Classifies once, commits — never switch
  mid-turn.
- Default to `fast` on ambiguity (bias toward latency; agent runs are
  expensive).
- Heuristic path must complete in < 5ms; LLM-classifier path must complete in <
  250ms p95.
- The router lives in the sidecar only. The desktop shell never classifies — it
  just forwards the transcript + screenshot to the sidecar.
- Router decision is logged with `reason` for later evaluation, but never
  persisted off-device beyond aggregated usage metering.

## Detailed Design

### Decision contract

```ts
// packages/shared/src/index.ts
export type IntentPath = "fast" | "agent"

export interface IntentClassification {
  path: IntentPath
  confidence: number // 0..1
  reason: string // short human-readable explanation
  source: "heuristic" | "llm"
}

export interface RouterInput {
  text: string
  screenshot_b64?: string
  history?: { role: "user" | "assistant"; text: string }[] // last 2 turns max
}
```

### Two-stage router

**Stage 1 — heuristic (always runs):** Cheap deterministic rules. Resolves the
vast majority of turns without an LLM call. Returns a classification with
`source: "heuristic"` and a confidence score derived from how many signals
fired. If confidence ≥ `HEURISTIC_CONFIDENCE_THRESHOLD` (default `0.8`), commit
and return.

**Stage 2 — LLM classifier (only on low-confidence heuristic):** A
forced-tool-call to a small model. Returns `source: "llm"`. Bounded by
`ROUTER_LLM_TIMEOUT_MS` (default `250`); on timeout, fall back to the
heuristic's tentative answer.

### Heuristic signals

**Strong `fast` signals (each +0.3):**

- Starts with a question word: `what`, `how`, `why`, `when`, `where`, `who`,
  `which`.
- Single-clause, ≤ 12 words.
- Contains explanation/translation/summary verbs: `translate`, `summarise`,
  `summarize`, `explain`, `define`, `read`.

**Strong `agent` signals (each +0.4):**

- Explicit trigger: matches `/^yomi[, ]+agent[, ]?/i`.
- Action verbs anywhere: `research`, `draft`, `send`, `schedule`, `book`,
  `create`, `open`, `file`, `download`, `install`, `deploy`, `commit`, `push`,
  `email`, `dm`, `message`.
- Multi-step connectives: `and then`, `after that`, `also`, `finally`, `then `.
- Length > 30 words (long requests are usually multi-step).

**Tie-break:** if both sides have signals, take the higher score. If equal,
return `fast` (invariant).

### LLM classifier (Vercel AI SDK)

Uses the same OpenAI provider as the fast pipeline (`@ai-sdk/openai`). Model
defaults to `gpt-5.4-mini`.

```ts
import { generateObject } from "ai"
import { z } from "zod"

const RouterDecision = z.object({
  path: z.enum(["fast", "agent"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(120),
})

const result = await generateObject({
  model: createModel(), // shared with pipeline/fast.ts
  schema: RouterDecision,
  system: ROUTER_SYSTEM_PROMPT,
  prompt: buildClassifierPrompt(input),
  abortSignal: AbortSignal.timeout(ROUTER_LLM_TIMEOUT_MS),
  maxTokens: 80,
})
```

### Wiring

The sidecar exposes `/query` as the unified entry point that classifies intent
then routes to the appropriate pipeline. `/query/fast` and `/query/agent` remain
available for tests and for desktop-side overrides.

## Files to change

- `apps/sidecar/src/index.ts` — add `/query` route that calls the router, plus a
  `router_decision` SSE event passthrough.
- `apps/sidecar/src/pipeline/fast.ts` — extract the STT-normalisation step so
  the router and the fast pipeline can share it (avoids running STT twice).
- `packages/shared/src/index.ts` — add `IntentPath`, `IntentClassification`,
  `RouterInput`, and a new SSE variant
  `{ type: "router_decision", path, confidence, reason, source }`.

## Files to create

- `apps/sidecar/src/router/intent.ts` — public
  `classifyIntent(input: RouterInput): Promise<IntentClassification>`;
  orchestrates heuristic → LLM fallback.
- `apps/sidecar/src/router/heuristic.ts` — pure heuristic scorer.
- `apps/sidecar/src/router/llm.ts` — `generateObject` classifier with timeout +
  abort handling.
- `apps/sidecar/src/router/heuristic.test.ts` — table-driven tests covering the
  signal matrix and ambiguity tie-breaks.
- `apps/sidecar/src/router/intent.test.ts` — integration test that mocks
  `generateObject` and verifies heuristic-skip, LLM-fallback, and
  timeout-fallback paths.

## Open Questions

- Confidence threshold (`0.8` initial) needs tuning against logged real traffic
  before enabling the LLM stage.
- Should the router consider the last 2 turns of history, or only the current
  transcript? Current plan: pass `history` through the contract but ignore it in
  Phase 0.
- First-token classification feasibility: needs an offline evaluation before we
  even prototype.
