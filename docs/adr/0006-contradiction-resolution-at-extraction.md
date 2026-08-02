# Contradiction is judged inside extraction; a confirmed one supersedes

Status: accepted

## Decision

A **contradiction** between a new memory and an existing one is decided by the
**per-turn extraction call that already runs**, not by a dedicated judge. A
confirmed contradiction **supersedes** the old memory rather than demoting it,
and every supersession is recorded so it can be undone later.

- **Judgment — folded into `captureBackendMemory`.** Before extraction, embed
  the **full turn** (user message + assistant reply), retrieve the ~20 nearest
  active memories, and put them in the extraction prompt. The model emits
  `replaces_id` — a real UUID it was shown — replacing today's blind
  `replaces_topic` string guess. Costs **one embedding**, no extra LLM call.
- **Recall, not verdict, comes from embeddings.** Cosine similarity finds
  memories on the same subject; it cannot separate a _contradiction_ from a
  _duplicate_ or an _elaboration_ (the contradicting pair is often the _less_
  similar one). The model makes the call; the vector search only shortlists.
- **Outcome — supersede, recoverably.** A confirmed contradiction sets the old
  row `status = 'superseded'`, `isLatest = false`. The `updates` relation edge
  is **non-optional** on every supersession — written in the same transaction as
  the supersession itself, so one cannot land without the other. The
  `parentMemoryId`/`rootMemoryId` chain follows only the **primary** row a save
  versions over: one save can supersede several memories on a topic and
  `parentMemoryId` holds a single id, so the edge, not the chain, is what
  guarantees every superseded row stays reachable. `GET /memory/superseded`
  exposes superseded rows and what replaced them. Undo UI belongs to the landing
  memory viewer (backlog #7); the data contract ships now so #7 isn't blocked.
- **Safety net — recency in the prompt.** Injected memory snippets render the
  memory's **age**, in both `fetchMemoryContext` and `fetchMemoryProfile`, plus
  one rule in the `<memory>` block: when two memories conflict, the more recent
  is current. The confidence number is **dropped** from the snippet. This is
  what catches the cases detection misses.
- **`isStatic` narrows.** It stops being derived from `kind` alone and is
  reserved for genuine identity/standing facts, so a stale preference is no
  longer permanently resident in every prompt.
- **Non-turn writers stay conservative.** The four call sites without
  conversational context (`POST /add`, the two other memory routes, approval
  replay, MCP `memory_add`) keep rule-based `relationForMemory`, minus the
  vacuous same-kind+same-scope `extends` branch and the `ilike(kind)` candidate
  clause that fed it. `derives` is dropped from `MemoryRelation` — nothing has
  ever produced it.
- **Billing — uncharged.** The extra embedding is background work on an
  already-charged turn; real API cost is still recorded in `ai_usage_events`.

## Why

The extraction call **already happens on every turn** and already has a
`replaces_topic` field — but the model guesses that string without ever being
shown what is stored, so it can only match by luck. Showing it the actual
candidates converts a blind guess into a grounded choice for the price of one
embedding. A dedicated judge inside `upsertMemory` was rejected: it would add an
LLM call to _every_ memory write including the bulk loop, as unmetered spend on
a paid path, to answer a question the turn-aware call is better placed to answer
anyway.

Supersede beat demote because demotion frees no injection budget — stale rows
accumulate forever and the fix leans entirely on ranking being right. Supersede
is the aggressive choice, so the recoverability guarantee is what makes it safe:
sharper detection fires more often, and therefore destroys a true memory more
often, and the version chain is the only thing standing between that and silent
memory loss.

The recency fix is deliberately separate from detection because **detection will
miss**. Two live contradictory memories currently reach the model with no
recency signal at all — `updatedAt` is selected and then never rendered — while
`confidence` _is_ shown, so the model actively prefers the stale, confidently-
stated one. Rendering age is a small diff that makes the failure survivable
instead of silent.

## Consequences

- **The candidate set is the recall ceiling.** A memory not retrieved before
  extraction can never be detected as contradicted, and the miss is silent. The
  opt-in eval fixtures are the only thing that will surface this; treat a
  regression there as load-bearing, not cosmetic.
- **`captureBackendMemory` swallows all errors** (`.catch(() => {})` at its call
  site). Adding a retrieval step widens the surface where an entire turn's
  memories vanish unnoticed.
- **The extractor prompt now carries the three-way distinction** — contradiction
  vs. duplicate vs. elaboration — defined in `CONTEXT.md`. The glossary and the
  prompt must stay in sync; if the definitions drift, the model starts
  superseding elaborations.
- Narrowing `isStatic` applies at **write time only** — there is no backfill, so
  memories already flagged static stay resident in every prompt until they are
  superseded or corrected. Existing users see the benefit slowly, and for old
  memories possibly never; revisit if the always-on profile stays bloated.
- Two write paths now decide relations differently (model-judged for turns,
  rule-based otherwise). That divergence is intentional but must be kept
  visible, or a future change will "unify" them by giving the API path
  supersession with no model in the loop.
- **Consolidation is deliberately not here.** Merging near-duplicate active
  memories is a separate backlog item; it needs a cron-job cost design this ADR
  does not attempt.
- Reversing this means moving judgment back out of the extraction call, which is
  a prompt and a call-graph change rather than a migration — the genuinely
  hard-to-reverse part is the supersession data written in the meantime, which
  is why the recoverability guarantee is recorded here.

## Update (2026-08-02)

`extends` is dropped from `MemoryRelation` entirely (#93). The judge this ADR
introduced emits `replaces_id` for a contradiction and nothing for a duplicate
or elaboration — it never gained a producer for `extends`, so the type kept
advertising a capability nothing built, the same argument that dropped `derives`
above. `relation_type` stays plain `text`, so any row already holding the string
is untouched; a future elaboration edge is a new decision, not a revival of this
one.
