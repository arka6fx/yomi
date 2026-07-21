# Telegram Agent Integration Nudge — Design

Date: 2026-07-21
Status: Approved (design); pending implementation plan

## Summary

When a user's Telegram message mentions an app or task that needs a
connector Yomi supports but the user hasn't connected, the agent should
name that connector and hand back a direct link to connect it on the
dashboard — instead of silently failing, hallucinating that it did the
task, or (the rejected alternative) always listing the full 60-connector
catalog regardless of relevance. Suggestions are computed per-message from
a lightweight word-match against the user's current text, so only what's
actually relevant to the task at hand gets surfaced, never the whole list.
The link is a deep link straight to that connector on the dashboard, not
a generic dashboard URL the user has to search from.

This is one of eight independent pieces of a larger request (Telegram
nudge, dashboard redesign, sign-up flow, custom MCP connector UI, settings
menu, dashboard home page, docs redesign, Google OAuth verification fix).
The user decided on this priority order: OAuth fix (done — see below),
this nudge feature (this spec), then the UI/design work as a separate,
later spec. This spec covers only the nudge feature.

### Note on the OAuth verification fix (out of scope here, already resolved)

No design or code needed. The homepage purpose sentence Google flagged was
already fixed and deployed (commit `a1d5d7ac`, verified live on
`getyomi.in`). The app-name mismatch is a Google Cloud Console OAuth
consent screen setting the user needs to check/correct themselves (not
accessible to Claude Code) — the homepage consistently shows "Yomi"
everywhere checked.

## Scope (v1)

- **In scope:** a pure connector-suggestion function in `agent-core`, one
  new system-prompt instruction, wiring into the existing
  `buildSystemWithContext` call in `apps/backend/src/agent/run.ts`.
- **In scope (added after review):** a minimal dashboard deep link so the
  nudge's link lands directly on the specific connector, not a generic
  dashboard URL the user has to search from.
- **Out of scope:** everything else about the dashboard/UI ("coming soon"
  badges, visual redesign, layout changes — deferred to the later
  UI-redesign spec), a `find_integrations` tool (rejected approach, see
  below), matching against chat history beyond the current message
  (explicitly declined by the user), any new database state for tracking
  "already nudged" (repetition control rides on existing chat history
  instead).

## Rejected approaches

1. **Always-on static catalog in the system prompt.** Compute the full
   list of unconnected connectors once per turn and always inject it. Cost:
   ~150–350 tokens on every single turn even when irrelevant, and — the
   reason this was rejected after further feedback — it puts all ~59
   unconnected connectors in the model's context on every turn, inviting
   unsolicited "did you know I also connect to Zoom, Miro, Kaggle..."
   suggestions unrelated to what the user is doing.
2. **On-demand `find_integrations(query)` tool.** The model calls a tool
   only when it suspects a gap. Keeps the prompt lean, but costs a full
   extra `generateText` round-trip (real added latency on a Telegram reply)
   every time it's actually used, plus a new tool to build/test/maintain.
   Rejected as unnecessary complexity for a 60-item, cheap-to-filter list.
3. **Stub tools for every unconnected connector**, so the existing "tool
   reports not connected" prompt instruction fires naturally. Rejected:
   would add up to ~59 dead tools to every user's tool set, working against
   the already-flagged `MAX_TOOLS = 128` cap in `agent.ts`'s `capToolSet`.

## Design

### 1. `packages/agent-core/src/integration-catalog.ts` (new file)

```ts
export interface IntegrationSuggestion {
  id: string
  name: string
  category: ConnectorCategory
}

// Connectors excluded from nudges regardless of connection state — not
// actually connectable yet, so suggesting them would be false hope.
// swiggy: code done, blocked on Swiggy's OAuth client allowlist (issue #73
// on their manifest repo).
const NUDGE_EXCLUDED_IDS = new Set(["swiggy"])

const MAX_SUGGESTIONS = 3

export function suggestIntegrationsFor(
  text: string,
  connectedIds: string[],
): IntegrationSuggestion[]

export function formatIntegrationSuggestions(
  suggestions: IntegrationSuggestion[],
  appUrl: string,
): string
```

`suggestIntegrationsFor` filters `ALL_CONNECTOR_DEFS` to those not in
`connectedIds` and not in `NUDGE_EXCLUDED_IDS`, then matches each
candidate's `name` against the user's `text` using **whole-word,
case-insensitive matching** (`\b<word>\b` regex, not substring
`.includes()` — substring matching would false-positive short names like
"Exa" inside unrelated words, e.g. "example"). A candidate matches if
either its full name matches as a phrase, or any individual word of a
multi-word name (≥3 characters) matches. Results are capped at
`MAX_SUGGESTIONS` (3) — a message that happens to mention several apps at
once (e.g. "connect this to Notion and Trello") legitimately returns more
than one, but the cap keeps a pathological match from producing a
grocery-list reply.

`formatIntegrationSuggestions` renders each suggestion with its deep link
inline, one per line, e.g.
`"Trello (productivity): https://getyomi.in/dashboard?connect=trello"`,
using `${appUrl}/dashboard?connect=${id}` (`appUrl` is the same
`YOMI_APP_URL`-derived value already used elsewhere in `run.ts`). Returns
`""` when the input is empty — callers use the empty string to omit the
block entirely, so a turn with no matches adds zero prompt weight. Giving
the model a concrete URL per suggestion means it hands back a real link
instead of composing one itself.

Both functions are pure (no I/O), matching the existing `recall.ts` /
`web-search.ts` pattern in this package: easy to unit test, no mocking
required.

### 2. Wiring (`apps/backend/src/agent/run.ts`)

`buildSystemWithContext` gains one more parameter, the formatted
suggestion string, computed in `runAgent` right before the call:

```ts
const suggestions = formatIntegrationSuggestions(
  suggestIntegrationsFor(opts.text, registry.getConnected()),
  appUrl,
)
```

This is injected as a labeled block only when non-empty, alongside a new
always-present instruction sentence (independent of whether there's a
match this turn, since the model needs the rule even when the block is
absent from earlier context):

> If the user's request needs an app you don't have a tool for, and it's
> named below, tell them by name and give them the link next to it to
> connect it — don't pretend you already did it. Don't repeat a nudge you
> already gave earlier in this conversation (check recent chat above).

This instruction is scoped strictly to "no tool exists for this app at
all in the current tool set." It must not collide with the two existing
prompt lines for connected-but-broken cases ("tool reports not connected"
/ "tool returns an authorization error") — those are unchanged and cover a
different failure mode (a connector that's connected but mid-call fails).

### 3. Dashboard deep link (`apps/landing/src/app/dashboard/page.tsx`)

`dashboard/page.tsx` already has a `useEffect` (around line 291) that
reads `window.location.search` for other one-shot flags (`welcome`,
`integration_success`/`integration_error`) and reacts by setting
`activeTab` and clearing the param from the URL. This gets one more case:

```ts
const connect = params.get("connect")
if (connect) {
  setActiveTab("integrations")
  setHighlightConnectorId(connect)
  params.delete("connect")
  const qs = params.toString()
  window.history.replaceState({}, "", qs ? `?${qs}` : window.location.pathname)
}
```

`highlightConnectorId` (new `useState<string | null>`) is passed down as
a new `highlightId` prop through `ConnectorMarketplace` →
`ConnectorTile` (`packages/ui-connectors/src/components/ConnectorMarketplace.tsx`).
The matching tile gets an `id={`connector-${info.id}`}` attribute (for
`scrollIntoView`) and a brief highlighted border/glow using existing
`ConnectorTheme` tokens (no new design tokens). This is a params-in,
props-down change to two existing components — not a layout or visual
redesign, and `ConnectorInfo`/`buildCatalog` are unchanged.

If `connect` names a connector id that doesn't exist in the catalog (stale
link, typo), the tab still switches to "integrations" and nothing
highlights — a silent no-op, not an error state.

### 4. Repetition control

No new database state. "Once per session" relies on the recent-chat
history (`fetchRecentChat`, last 20 turns) already injected into the
system prompt — the instruction tells the model to check it before
repeating a nudge. This degrades gracefully rather than perfectly: a
conversation longer than 20 turns could re-nudge after the history window
rolls past the first mention. Acceptable for a UX nicety; not worth new
state to close.

### 5. Testing

Unit tests for `suggestIntegrationsFor` and `formatIntegrationSuggestions`
in `packages/agent-core/src/integration-catalog.test.ts`:

- Returns matches for a message naming a connector by its full name.
- Returns matches for a message naming one word of a multi-word connector
  name (e.g. "calendar" → Google Calendar, if unconnected).
- Does not match a short name as a substring inside an unrelated word
  (e.g. "example" does not match "Exa").
- Excludes already-connected connector ids even when named in the text.
- Excludes `swiggy` even when named and unconnected.
- Caps results at `MAX_SUGGESTIONS` when a message names more than that
  many unconnected connectors.
- Returns `[]` / `""` for a message that names nothing connector-related.
- `formatIntegrationSuggestions` builds the correct `?connect=<id>` URL
  per suggestion.

For the dashboard piece: no unit test for the `useEffect` (matches the
existing untested sibling cases in the same effect), verified instead by
running the app and visiting `/dashboard?connect=<id>` directly (per this
project's `run` skill) to confirm the tab switches and the tile
highlights.

No LLM-behavior test for the agent-core half — consistent with how
`buildSystemWithContext` itself isn't behavior-tested beyond what flows
into it.
