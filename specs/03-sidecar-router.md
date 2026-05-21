# Spec 03 — Sidecar: Intent Router

## Purpose

Define the intent router that classifies every user request as either `fast` or `agent` at the start of each turn. The router is the first step in every query and determines which pipeline handles it.

## Invariants

- The router runs at the START of every turn. It classifies once and commits — never switch mid-turn.
- Default to fast path on ambiguity (bias toward latency).
- The router call must complete in < 100ms (uses a small/fast model or heuristic).

## Detailed Design

### Intent Router

A lightweight classification call made before routing. Uses a small/fast model or heuristic classifier.

```
Input:  transcript + screenshot (if available) + last 2 turns of history
Output: { path: "fast" | "agent", confidence: number, reason: string }
```

**Fast path signals:**
- Question form ("what", "how", "explain", "what does this mean")
- Single-step request ("translate this", "summarise this text")
- No verbs implying multi-step action ("research", "draft", "send", "schedule", "create")

**Agent path signals:**
- Action verbs: "research", "draft", "send", "schedule", "book", "create", "open", "file"
- Explicit trigger: "Yomi agent, ..."
- Multi-part: "and then", "also", "after that"

Default to fast path on ambiguity.

### Router Implementation Options

**Option A — Dedicated classifier call (Phase 0):**
A tiny LLM call (e.g. `claude-haiku`) with a forced tool call. Simple, accurate, but adds one round-trip (~150ms).

**Option B — First-token classification (Phase 1+):**
Embed the classification in the first generated token of the pipeline model. Saves a round-trip. More complex to implement — requires streaming the first token as a routing decision before the actual response begins.

Start with Option A; migrate to Option B when latency becomes a measured bottleneck.

## Files to change

- `apps/sidecar/src/index.ts` — register router middleware before pipeline routes

## Files to create

- `apps/sidecar/src/router/intent.ts` — Intent router (classifies fast vs agent)

## Open Questions

- Option B feasibility: can the first token reliably encode a routing decision without biasing the subsequent response? Requires testing with the chosen model.
