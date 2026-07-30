# Session summaries reuse the memory engine; recall is a deliberate tool

Status: accepted

## Decision

Cross-session recall is built on the **existing memory engine**, not a new
store. A background summarizer writes **incremental per-session checkpoint
summaries** as `memory_entries` rows, and the agent reaches them through **one
deliberate tool**, never passive injection.

- **Trigger — idle sweep.** Agent sessions are perpetual (they only close on
  `/new`), so summarization runs from the existing per-minute `runCronSweeps`:
  find sessions idle > ~30 min with messages past the last summarized point,
  summarize that window. One mechanism covers both perpetual and `/new`-closed
  sessions.
- **Granularity — incremental checkpoints.** Each sweep summarizes only the
  messages since the last checkpoint and **appends a new row** (never re-reads
  the whole transcript). Cost is bounded per sweep and rows are naturally
  time-scoped, so "what did we decide last week" works.
- **Storage — `memory_entries` rows.** `kind: "session_summary"`,
  `sourceType: "agent_session"`, `sourcePath: <sessionId>`, `content` = the
  summary, `metadata` =
  `{ sessionId, fromMessage, toMessage, fromTime, toTime }`. A per-session
  `agent_sessions.summarizedMessageCount` marks the unsummarized window.
- **Recall — a tool, excluded from injection.** `session_summary` rows are
  filtered **out** of passive memory injection; the agent reaches them only via
  a new `recall_past_conversations(query, since?, limit)` extraTool that runs
  the existing hybrid vector+FTS+RRF search filtered to
  `kind = "session_summary"`.
- **Consent — inherited.** `agent_sessions`/`agent_messages` are only written
  when `conversationHistoryEnabled` is granted, so summaries can only ever exist
  for consenting users; the sweep additionally filters to them, so revocation
  stops new summaries immediately.
- **Billing — uncharged.** Background summarization debits no credits (per
  ADR-0001 for unprompted work); real API cost is still recorded in
  `ai_usage_events`. The recall tool call runs inside an agent turn already
  charged as a Telegram message.

## Why

Reusing the memory engine buys hybrid search, append-only time-scoped rows, and
the whole retrieval/deletion pipeline **for free** — a dedicated
`session_summaries` table would re-implement and re-test search for no
capability gain. The `kind` discriminator keeps summaries cleanly separable from
curated facts.

Tool-only recall (plus the injection exclusion) keeps the **paid** Telegram
prompt lean and makes looking back a deliberate act the agent chooses, rather
than silently bloating every turn with summary text. Incremental checkpoints are
forced by the perpetual-session reality: re-summarizing a weeks-long transcript
on every sweep is unbounded cost and collapses the time granularity the recall
use-case depends on.

## Consequences

- `memory_entries` now carries two provenance classes (curated facts vs. session
  summaries). **Every reader must be `kind`-aware** — the passive-injection
  query in `agent/run.ts` must exclude `kind = "session_summary"`, or summaries
  leak into every prompt.
- The recall tool is the sole consumer of `session_summary`. If a general
  memory-search tool is added later, it must decide whether to include these.
- Revoking `conversationHistoryEnabled` stops new summaries; existing ones are
  removed via the privacy deletion path — verify that path covers
  `kind = "session_summary"`.
- Reversing this (a dedicated table) means migrating rows and rebuilding search,
  which is why the memory-engine reuse — the load-bearing choice — is recorded
  here.
