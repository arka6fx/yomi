# Yomi — Agentic Capability Backlog

A ranked shortlist of agentic capabilities and codebase improvements for the
**backend + landing + shared packages** (the desktop **sidecar is out of scope**
for implementation). Derived from the reference agents in `ref/` (hermes-agent,
supermemory, nia, composio, pi, openclaw) measured against what Yomi already
has.

## Scope & method

- **Lens:** capability-weighted-both — rank by user-facing/differentiating
  impact, fold in codebase-health only where cheap or blocking.
- **Sort:** impact-to-effort ratio, differentiation as tiebreaker. Size = S/M/L.
- **Constraints (adopted):** no new connectors · stay on the current stack
  (OpenAI
  - Vercel AI SDK single-loop, RDS Postgres/Drizzle, EC2/Cloudflare — no new
    orchestrator, no new managed vendors) · billing/auth internals not a primary
    target · **no sidecar/desktop implementation** (shared `packages/agent-core`
    is fair game).

## Findings that frame the list

- **The sidecar is gone, not just out of scope.** ADR 0002 retired the desktop
  client and the sidecar it drove; `apps/sidecar` no longer exists in this repo
  (only `apps/backend` and `apps/landing` remain). The LangGraph-was-never-used
  finding below is kept for history — it no longer needs "out of scope" framing
  since there's nothing left to scope around.
- **Backend memory is already an engine, not a store.** `routes/memory.ts` +
  `agent/run.ts` give versioned entries, hybrid vector+FTS+metadata RRF search,
  a relations graph (`updates` supersession edges), temporal `forgetAfter`
  forgetting, and per-turn LLM fact-extraction (`captureBackendMemory`). So the
  supermemory pattern is _largely built_ — several items below **sharpen** it
  rather than build it.
- **The backend agent loop is lean.** `runAgentLoop` (agent-core) is one
  `generateText` with `maxSteps` (default 12) + a hermes-style grace call. No
  loop guards, no iteration budget, no subagent delegation, non-streaming. It
  exposes an `extraTools` hook — the clean, low-footprint seam for new
  capabilities.

## Ranked backlog

| #   | Item                                                              | Size | Type                  | Inspired by                            | Why it matters                                                    |
| --- | ----------------------------------------------------------------- | ---- | --------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| 1   | ✅ **DONE** — Loop guards + iteration budget on the backend agent | S    | Foundation            | sidecar `LoopGuards`/`IterationBudget` | Caps runaway tool loops & cost on the paid Telegram path          |
| 2   | ✅ **DONE** — Proactive suggestions from telemetry + memory       | M    | Capability            | hermes self-nudge                      | Turns a static 5-item catalog into personalized, earned nudges    |
| 3   | ✅ **DONE** — Session summarization + cross-session recall tool   | M    | Capability            | hermes FTS5 recall                     | "What did we decide last week?" — memory that spans sessions      |
| 4a  | Memory contradiction resolution (designed — ADR 0006)             | M    | Capability/Health     | supermemory                            | Stops Yomi contradicting itself; correctness of the memory engine |
| 4b  | Memory consolidation sweep (near-duplicate merge)                 | M    | Health                | supermemory                            | Stops duplicate memories crowding the injection budget            |
| 5   | Deep-research tool (bounded sub-loop over RAG+memory+web)         | M/L  | Capability            | nia Oracle                             | Cited synthesis instead of one-shot retrieval                     |
| 6   | Subagent delegation on the backend agent                          | M    | Capability/Foundation | hermes / sidecar subagent              | Parallel workstreams; unblocks bigger tasks                       |
| 7   | Landing: memory viewer + usage/cost insights                      | M    | Capability/Trust      | openclaw / nia dashboards              | User-visible control over memory + spend; privacy story           |
| 8   | Self-improving skills / learning loop                             | L    | Capability            | hermes + composio                      | The differentiator nobody else ships — agent gets better with use |
| 9   | Grow `agent-core` into the shared "brain"                         | L    | Foundation            | pi agent runtime                       | One loop both surfaces share; kills backend/sidecar divergence    |
| 10  | RAG "index anything" beyond Drive                                 | M/L  | Capability            | nia universal indexing                 | Ingest URLs/PDFs/pasted text, not only Drive sync                 |

---

## Item detail

### 1. Loop guards + iteration budget on the backend agent — S · Foundation

✅ **DONE** (commit `e1beb80c`). Shipped in `packages/agent-core/src/guards.ts`
(`LoopGuards`: duplicate-call + stall detection + cheap-tool step-budget refund)
and `agent.ts` (`runAgentLoop`: step budget default 25, env `AGENT_MAX_STEPS`,
plus an output-token budget `AGENT_MAX_OUTPUT_TOKENS`). Wired into the paid path
at `apps/backend/src/agent/run.ts:571`; covered by `guards.test.ts`. The
description below is the original pre-work framing, retained for history.

`runAgentLoop` trusts `maxSteps=12` and a grace call; it has no duplicate-call /
stall detection and no output-token budget. The sidecar already has `LoopGuards`
and `IterationBudget` — port the _concepts_ (not the sidecar code) into
`agent-core`. Cheapest item on the list and it protects a **paid** path (every
Telegram message is charged), so a wedged loop is real money. **Touches:**
`packages/agent-core/src/agent.ts`, `apps/backend/src/agent/run.ts`.

### 2. Proactive suggestions from telemetry + memory — M · Capability

`services/suggestions/catalog.ts` is 5 hardcoded entries. Replace/augment with
an agent-generated layer grounded in `ai_usage_events`, `memory_entries`, and
the user's connected providers — e.g. notice they ask about GitHub PRs every
morning and offer a standing digest. This is hermes's "self-nudge to persist
knowledge" applied to automation discovery. **Touches:**
`services/suggestions/*`, `routes/suggestions.ts`, `ai-telemetry`.

### 3. Session summarization + cross-session recall tool — M · Capability

✅ **DONE.** Shipped in `apps/backend/src/services/agent-sessions.ts`
(`summarizeSession` / `summarizeUnsummarizedSessions`, generateObject-based
title+summary per session) and wired into the agent as the
`recall_past_conversations` `extraTool` in `agent/run.ts`, backed by a hybrid
FTS + RRF search over session summaries (ADR 0003). The description below is the
original pre-work framing, retained for history.

You store `agent_sessions` and `agent_messages` but the agent can't search its
own past. Add a background summarizer (per session) and expose a
`recall_past_conversations` `extraTool` that does hybrid search over those
summaries — hermes's FTS5 + LLM-summary recall. Leverages data you already keep.
**Touches:** `services/agent-sessions.ts`, `agent-core` extraTools, memory
search.

### 4a. Memory contradiction resolution — M · Capability/Health

📐 **DESIGNED** — see
[ADR 0006](adr/0006-contradiction-resolution-at-extraction.md) and the
`Memory contradiction` section of `CONTEXT.md`. Not yet built.

Two independent causes make Yomi contradict itself. **Detection**:
`relationForMemory` matches normalized topics by **string** equality, so
paraphrased corrections ("I use vim" later "switched to VS Code") never fire and
both rows stay active. **Injection**: the memory snippet renders `kind`,
`confidence`, `topic`, `content` but silently drops `updatedAt`, so when two
contradictory memories do both survive the model gets no recency signal — and
because confidence _is_ shown, it prefers the stale one.

Fix folds contradiction judgment into the per-turn extraction call that already
runs (candidates retrieved by embedding the full turn, model emits a real
`replaces_id`), supersedes recoverably, renders memory age in both injection
paths, and narrows `isStatic` so stale preferences stop being permanently
resident. **Touches:** `routes/memory.ts`, `agent/run.ts`.

### 4b. Memory consolidation sweep — M · Health

Split out of the original #4 (see 4a). A periodic job that merges near-duplicate
**active** memories — distinct from contradiction, which supersedes an
incompatible memory; a duplicate makes the _same_ claim in different words.
Would be a 6th job in `runCronSweeps` (`index.ts`), following the
`summarizeUnsummarizedSessions` template.

Deferred deliberately: narrowing `isStatic` in 4a already cuts a large part of
the prompt bloat this targets, so build it only once there's evidence duplicates
still hurt. **Unresolved:** merge sweeps need LLM calls as unmetered background
spend, with no per-user fairness or cost-cap story yet — that design is the real
work here. **Touches:** `routes/memory.ts`, `index.ts` / `worker.ts` sweeps.

### 5. Deep-research tool (bounded sub-loop over RAG+memory+web) — M/L · Capability

`fetchRagContext` is one-shot top-5 FTS. Add an `extraTool` that runs a small,
step-capped researcher loop (query → retrieve from RAG + memory + web → refine →
synthesize with inline citations), returning a synthesis instead of raw chunks —
nia's "Oracle." Note: the backend web-search gap this once implied is already
closed — `web_search` is a live `extraTool` in `agent/run.ts` — so this item is
purely about adding a bounded multi-step research loop on top of it.
**Touches:** `agent-core` extraTools, `services/rag/*`.

### 6. Subagent delegation on the backend agent — M · Capability/Foundation

Add a `delegate` `extraTool` that spawns a bounded, isolated `runAgentLoop` for
a sub-task, so the main agent can fan out parallel workstreams and collapse
multi-step pipelines — the hermes pattern the sidecar already has. Depends on #1
(guards) so a delegated loop can't run away. **Touches:**
`packages/agent-core/src/agent.ts` (recursion + budget), backend wiring.

### 7. Landing: memory viewer + usage/cost insights — M · Capability/Trust

The memory + telemetry APIs exist (`routes/memory.ts`, `ai_usage_events`) but
there's no UI. Add dashboard surfaces: browse/edit/forget memories, and a
spend + usage view. Strong privacy/trust story (users see and control what Yomi
remembers). **Caveat:** landing deploys **asset-only** (see memory
`project_landing_asset_only_deploy`) — build as client-side fetches to the
backend API, not SSR/route handlers. **Touches:** `apps/landing/*`, consumes
existing backend routes.

### 8. Self-improving skills / learning loop — L · Capability

The biggest differentiator and the biggest bet. After a successful multi-step
task, distill the procedure into a reusable, named "skill" (params + steps)
stored canonically; retrieve relevant skills into future prompts; refine them on
reuse. This is hermes's closed learning loop + composio's "skills that evolve."
Best done **after** #1/#6/#9 so there's a stable loop to hang it on.
**Touches:** new `skills` table in `packages/db`, `agent-core`, backend agent.

### 9. Grow `agent-core` into the shared "brain" — L · Foundation

**Largely moot since the sidecar retirement (ADR 0002).** The original rationale
— backend/sidecar loop divergence — no longer applies; there is no sidecar loop
left to unify with. What's left of this item is just internal organization of
`agent-core` itself (memory-context assembly, guards, budget as clean seams
within the one remaining loop), which items #5/#6/#8 can lean on incrementally
as they're built rather than needing a dedicated upfront pass. Kept for history;
deprioritize unless a specific item below needs the seam. **Touches:**
`packages/agent-core/*`, `apps/backend/src/agent/run.ts`.

### 10. RAG "index anything" beyond Drive — M/L · Capability

RAG only ingests Google Drive (`services/rag/drive-*`). Add ingestion for pasted
URLs, uploaded PDFs, and raw text into the same `rag_documents`/`rag_chunks`
pipeline — nia's universal indexing. Ranked last: it's the most infra-heavy and
edges toward "source" territory, but it's not a new _connector_ and it
multiplies the value of #5. **Touches:** `services/rag/*`, `routes/rag.ts`, a
new extract path.

---

## Suggested sequencing

- **✅ Done:** #1 (loop guards, `e1beb80c`), #2 (proactive suggestions,
  #46–#51), #3 (session summarization + cross-session recall, ADR 0003).
- **Highest impact-to-effort next:** #4a (memory contradiction resolution) —
  directly hardens the recall engine #3 just shipped, and the embeddings it
  needs already exist. Designed in ADR 0006; #4b (consolidation) split out
  behind it.
- **Then pick a differentiation bet:** #8 (self-improving skills) if you want
  the learning loop, or #5 → #10 if you want research/knowledge depth. #9 is
  deprioritized (see its entry above) now that there's no sidecar to unify with.

With #1, #2, and #3 shipped, **#4a** has been through `/grill-with-docs` and is
recorded in ADR 0006 — it is the next item to build.
