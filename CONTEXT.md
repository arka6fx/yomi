# Yomi

Glossary for the Yomi backend's domain language. Terms here are canonical; when
code or conversation drifts, this file wins.

## Proactive suggestions

**Proactive suggestion**: A personalized, system-generated proposal offered to a
user without them asking. Its artifact is always a _proposed schedule_ (see
below) — same shape as a catalog entry — so accepting one creates a `schedules`
row and nothing else. _Avoid_: nudge, recommendation, tip (reserve "nudge" for a
future non-schedule variant).

**Catalog suggestion**: A hardcoded `SUGGESTION_CATALOG` entry, gated only by
connected provider and Telegram. The static baseline that generated suggestions
augment or replace.

**Proposed schedule**: The artifact a suggestion carries:
`{title, description, spec: {schedule, prompt, deliverTo}}`. Not itself a
`schedules` row — becomes one only on accept.

**Suggestion decision**: A latched `accepted` | `dismissed` record keyed by
`(userId, dedupKey)`. Guarantees a given suggestion is never re-offered once
acted on.

**Earned**: Property a generated suggestion must have: justified by recurring
behavior actually observed in telemetry, not inferred from a single fact. An
un-earned suggestion is a bug, not a feature.

**Evidence gate**: The telemetry side of generation. `ai_usage_events`
(content-free) proves a behavior is real and recurring — which connector, what
cadence, what time of day. No topic lives here. Gates _whether_ to suggest.

**Topic enrichment**: The memory side of generation. `memory_entries`
(content-bearing) supplies specificity — the repo, project, or standing focus
that turns a generic "{connector} digest" into a personal one. Shapes _what_ the
suggestion says, never _whether_ it fires, and never its identity.

**Evidence signature**: The `(connector, cadence-bucket)` pair a suggestion was
earned from, and its identity for latching:
`dedupKey = gen:{connector}:{timeBucket}`, computed by code from structured
slots the model emits. Coarse on purpose — one suggestion per behavioral
pattern, and immune to topic/wording drift so a dismissed suggestion never
re-offers.

**Degradation ladder**: Generation honors existing consent by degrading, not
refusing. Memory consent on → topic-enriched suggestions; memory consent off →
content-free, telemetry-only suggestions (same generator as the cold-start
path). "Proactive" describes the generation being unprompted — never that
suggestions are pushed at the user.

## Session recall

**Agent session**: A perpetual conversation thread keyed by
`(userId, platform, chatId)` in `agent_sessions`. Stays `active` indefinitely;
only ends when the user sends `/new`. Its turns live in `agent_messages`,
persisted only when `conversationHistoryEnabled` consent is granted.

**Session summary**: A `memory_entries` row with `kind = "session_summary"`
capturing what happened in a slice of an Agent session (decisions, topics,
outcomes). Provenance is the session (`sourceType: "agent_session"`,
`sourcePath: <sessionId>`) — distinct from a curated _fact_, though both share
the `memory_entries` table. Excluded from passive memory injection.

**Checkpoint**: One incremental Session summary covering the message window
since the last one (`{fromMessage, toMessage, fromTime, toTime}`). Append-only:
a growing session accumulates checkpoints rather than one re-summarized blob, so
recall is time-scoped.

**Recall**: The agent _deliberately_ searching its own past via the
`recall_past_conversations` tool (hybrid search over
`kind = "session_summary"`). Distinct from _injection_ — the passive, always-on
surfacing of relevant curated memory into the system prompt. Recall is pull, on
demand; injection is push, every turn.

## Capability model

Canonical vocabulary for what plugin, MCP, and automation code is allowed to do.
Full design in [ADR-0005](docs/adr/0005-capability-based-security-model.md).

**Capability**: Permission for a caller to _attempt_ a class of operation,
checked before execution — it answers "may this caller even try?". Distinct from
an _approval_, which answers "does the user consent to this specific write?". A
caller lacking the capability is denied outright; a caller holding it may still
hit the approval gate. _Avoid_: permission, grant (reserve those for the
user-facing act of granting one).

**Scope**: The unit a capability is expressed as — a `resource:action` string
like `memory:read` or `agent:execute`. Wildcards widen it: `memory:*` (all
actions on memory), `*:*` (everything, reserved for `core` callers). _Avoid_:
permission string.

**Resource**: The thing a caller interacts with — one of `memory`, `schedule`,
`connector`, `agent`, `profile`, `filesystem`. The left half of a scope.
_Avoid_: object, target.

**Action** (capability): The verb in a scope — `read`, `write`, `delete`, or
`execute`. The right half of a scope. NOT `pendingActions.action`, which names a
concrete connector operation (e.g. `send_email`) — call _that_ an operation to
keep the two apart. _Avoid_: operation.

**Trust boundary**: The tier a piece of code runs at, fixed by how it was
loaded: `core` (built into yomi-core, full trust — implicit `*:*`), `plugin`
(registered, checked against its manifest), or `external` (MCP/API caller,
limited to the authenticated caller's scopes). Determines how a caller's
capability set is resolved. _Avoid_: privilege level, tier, sandbox.

**Capability manifest**: What a `plugin`-boundary caller declares it needs:
`{ required: Scope[], optional: Scope[] }`. A missing `required` scope means the
plugin can't load; a missing `optional` one means it degrades gracefully.
_Avoid_: permission list.

**Approval gate**: The pre-existing, _separate_ check that queues a _pending
action_ for user consent on a risky write. Orthogonal to capabilities and
applied second: a call clears the capability check, then the approval gate.
Failing the capability check denies immediately; tripping the approval gate
queues a pending action instead. _Avoid_: capability check (they are different
gates).
