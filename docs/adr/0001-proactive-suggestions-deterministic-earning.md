# Proactive suggestions: deterministic earning, the LLM only phrases

Status: accepted

## Decision

Generated proactive suggestions split labor so that **code decides _whether_ to
suggest, and the LLM only decides _how it reads_.** SQL over the content-free
`ai_usage_events` telemetry determines whether a behavior is "earned" (a habit
observed across ≥3 distinct days in a 30-day window, clustered in a time bucket);
only qualifying patterns are passed to a fast-model generation call, whose sole job
is to phrase the suggestion and draw topic specificity from `memory_entries`. A
suggestion's identity for dismiss-latching is a coarse, code-computed
`gen:{connector}:{timeBucket}` — never anything the model authored.

## Why

The obvious design is "feed the LLM the user's data and let it propose automations."
We deliberately rejected that. Deterministic, code-side earning buys three things a
free-running LLM cannot: **safety** (no hallucinated habits — every suggestion traces
to observed, recurring telemetry), **cost control** (the earning SQL is free, so the
LLM call is a cheap structured-phrasing task on the fast model, and it stays
uncharged to the user), and **drift-proof identity** (a code-derived
`(connector, timeBucket)` key means a dismissed suggestion never silently re-offers
under reworded output). The catalog remains the cold-start floor; generation augments
it. Consent is honored by _degrading_ — memory-off falls back to the same
content-free telemetry-only generator — rather than by gating the feature off.

## Consequences

- `validateScheduleInput` moves upstream to generation time: an LLM-authored schedule
  is untrusted, so a malformed one is dropped as a candidate instead of 500-ing on
  accept (the catalog path assumed its own schedules valid).
- Dedup against _manually created_ schedules is best-effort (connector + time bucket);
  hand-rolled schedules carry no dedup key, so occasional near-duplicate offers are
  accepted for v1 rather than building exact matching.
- Because earning is code-side, the model can be swapped or removed without changing
  _what_ gets suggested — only the wording. Reversing the split (letting the LLM
  decide _whether_) would require re-deriving identity, cost, and safety guarantees
  from scratch, which is why this is recorded.
