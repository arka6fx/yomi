# Connector starter prompts — design

Status: approved
Date: 2026-08-09

## Problem

Connector products (Yomi included) break at the same spot in onboarding: the
user creates an account, connects an app or two, and then has nothing to do —
just an empty Telegram chat. Capability with no first move. Today:

- `NextStepCard` (`packages/ui-connectors/src/components/NextStepCard.tsx`)
  only nudges *which connector to connect next* (`NEXT_STEP_PRIORITY`,
  lines 18-61) — it never tells the user what to actually ask Yomi once
  something is connected.
- The dashboard's post-connect redirect (`routes/integrations.ts:423`,
  `?integration_success=<id>`) just flips to the Integrations tab and shows a
  5-second banner (`apps/landing/src/app/dashboard/page.tsx:159-161,
  269-274`). No example usage.
- Telegram's only first-contact flow is personality onboarding (`soul.ts`) —
  it ends with "What can I help you with?" and hands off to the normal agent
  path. No suggested prompts are ever sent, per-connector or otherwise.
- The existing `services/suggestions/` system (`generate.ts:138`:
  `if (patterns.length === 0) return []`) is gated on *earned* usage
  patterns — it structurally cannot fire for a brand-new connection, and has
  no frontend consumer yet. It solves a different, later-stage problem
  (surfacing automations from established behavior) and is untouched by this
  spec.

## Goal

When a user connects a connector, they see (and are told, in the surface
where the empty-chat problem actually happens) 1-3 concrete example prompts
for that connector — phrased as outcomes ("tell me when a Notion page
changes"), not features ("trigger + action"), and specific to the app(s)
they just connected.

Two surfaces, both driven by the same content:

1. **Dashboard** — the connector's card, once connected, shows its starter
   prompts inline.
2. **Telegram** — Yomi proactively sends a message with the same prompts
   shortly after the connector finishes linking, landing exactly where the
   original friction was described ("staring at an empty Telegram chat
   wondering what to type").

## Non-goals

- No retroactive nudge for connectors already connected before this ships.
  Only newly-created `mcpConnections` rows trigger it — existing active
  users don't get a surprise message.
- No nudge on reconnect/re-auth of an already-connected provider (token
  refresh, re-granting scopes). Only a genuinely new connection.
- No changes to `services/suggestions/` (earned-pattern automation offers) —
  a separate, already-built system for a different stage of the lifecycle.
- No copy-to-clipboard interaction on the dashboard card (considered and
  rejected in favor of plain text — see Dashboard section).
- No changes to which connectors are marketed/available; `google-photos` and
  `swiggy` are excluded from starter-prompt coverage since they're
  `available: false` in the catalog and can't actually be connected yet.
- Redesigning `NextStepCard` or the connector-marketplace layout beyond the
  one addition described below.

## Architecture

### A. Shared starter-prompts catalog

New file `packages/shared/src/starter-prompts.ts`:

```ts
// Per-connector example prompts shown once a connector is connected — on its
// dashboard card and in the proactive Telegram nudge. Phrased as outcomes the
// user can paste verbatim, not feature descriptions. Keyed by connector id,
// matching ConnectorInfo.id / ConnectorDef.id.
export const STARTER_PROMPTS: Record<string, string[]> = {
  notion: [
    "Tell me when the roadmap page changes",
    "Summarize this week's meeting notes",
  ],
  slack: [
    "Summarize unread messages in #general",
    "Notify me when someone mentions me",
  ],
  github: [
    "Tell me when a PR is opened against main",
    "Summarize open issues labeled bug",
  ],
  "google-calendar": [
    "Let me know if I have back-to-back meetings tomorrow",
    "Find a 30-minute slot this week for a call with Sam",
  ],
  linear: [
    "Tell me when a P0 issue is created",
    "Summarize what's in progress on my team",
  ],
  // ... one entry per `available: true` connector in
  // packages/ui-connectors/src/catalog.ts (~51 connectors). Full copy is an
  // implementation-time content task — each entry must reference something
  // the connector's actual tools can do (grounded in its ConnectorDef tool
  // set / catalog description), never generic "boost your productivity"
  // marketing copy. This is the concrete lesson from the LinkedIn feedback
  // that prompted this spec: an example that only makes sense for an app the
  // user hasn't connected reads as marketing, not something they can run
  // right now.
}
```

Coverage: every connector with `available: true` in `CATALOG_DEFS`
(`packages/ui-connectors/src/catalog.ts:13-587`) — both first-class
(Gmail, Calendar, Drive, Classroom, Tasks, Meet, GitHub, Notion, Slack,
Linear) and Composio-backed (HubSpot, Trello, Jira, Outlook, Dropbox,
Figma, ...). 2 prompts per connector, except where a connector's toolset is
narrow enough that only 1 genuinely concrete example exists — no
padding with a weak second example just to hit a count.

`packages/ui-connectors` currently has no dependency on `@yomi/shared`
(confirmed: `package.json` has no `dependencies` block). This spec adds
`"@yomi/shared": "workspace:*"` to it.

`ConnectorInfo` (`packages/ui-connectors/src/types.ts:17-30`) gains:

```ts
starterPrompts: string[]
```

populated in `buildCatalog()` (`catalog.ts:592-608`) via
`STARTER_PROMPTS[def.id] ?? []`.

### B. Dashboard: connector card

`ConnectorTile` (`packages/ui-connectors/src/components/
ConnectorMarketplace.tsx:82-94`, the `info.connected` block) gains a new
block directly below the Connected badge:

```tsx
{info.connected && info.starterPrompts.length > 0 && (
  <div className="border-t border-border pt-2">
    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
      Try asking Yomi
    </p>
    {info.starterPrompts.map((p) => (
      <p key={p} className="text-xs text-muted-foreground">"{p}"</p>
    ))}
  </div>
)}
```

Plain text, no interaction — validated against two mockup options during
design (always-visible text vs. tap-to-copy chips); plain text won as
simpler and sufficient, since the actual place a user *acts* on the prompt
is Telegram, not the dashboard.

### C. Telegram: proactive nudge

**Trigger.** In `routes/integrations.ts`, at both connector-connect success
points (Google OAuth path, after the `mcpConnections` upsert at
`:395-408`; the generic/Composio connect path, around `:635`): before the
upsert, `SELECT` for an existing `(userId, provider)` row. If none exists
(this is a genuinely new connection, not a reconnect), after the upsert
succeeds, call a new best-effort helper:

```ts
markConnectorConnected(userId: string, connectorId: string): Promise<void>
```

in a new `apps/backend/src/services/connector-nudge.ts`. It upserts
`user.pendingConnectorNudge`:

- If no pending nudge exists for the user: create
  `{ connectorIds: [connectorId], dueAt: now + 5min }`.
- If one exists: append `connectorId` to `connectorIds` (dedup) and leave
  `dueAt` untouched — later connects in the same burst extend the batch
  without pushing delivery out further, guaranteeing the nudge fires.

Called the same way `grantConsentIfUndecided` already is at that call site
(`:419-421`) — fire-and-forget, `.catch()`-logged, never blocks the
redirect.

**Storage.** New column on `user`
(`apps/backend/src/auth-schema.ts:33-36`, alongside `agentSoul` /
`soulOnboarding`):

```ts
pendingConnectorNudge: jsonb("pending_connector_nudge"),
```

Nullable jsonb, shape `{ connectorIds: string[]; dueAt: string }`. No new
table — this follows the same extend-the-`user`-table-in-place convention
the file already uses for onboarding state.

**Delivery sweep.** New `runDueConnectorNudges(now = new Date())` in
`connector-nudge.ts`, modeled directly on `runDueSchedules`
(`schedule-runner.ts:41`):

1. Query users where `pendingConnectorNudge->>'dueAt' <= now`.
2. For each: look up their Telegram `platformChatId` via
   `platformConnections` (`packages/db/src/schema.ts:561-562`, `platform =
   "telegram"`). If none linked, clear the pending nudge and skip — most
   dashboard-only users haven't reached Telegram yet, this is not an error.
3. Build the message from `STARTER_PROMPTS`, capped at 3 total prompts
   across all connectors in the batch (1 each if multiple connectors, up to
   2 if just one) — matches the "three concrete starter workflows" framing
   from the original feedback.
4. Send directly via the Telegram Bot API `sendMessage` call — **not**
   `runAgent()`. This is a template fill, free, uncharged, matching how
   `soul.ts`'s onboarding turns are never billed.
5. Clear `pendingConnectorNudge` on the user row (success or Telegram-send
   failure alike — best-effort, no retry, matching every other
   best-effort convention in this codebase).

`telegramChatFor` and `sendTelegram` are currently private helpers inside
`schedule-runner.ts` (`:9-24`, `:24-38`). This spec extracts them into a
new `apps/backend/src/services/telegram-delivery.ts` and updates
`schedule-runner.ts` to import them, so both sweeps share one delivery
path instead of duplicating it.

**Wiring.** `runDueConnectorNudges` is added to the same two call sites
that already run `runDueSchedules` on a 60s tick: `worker.ts:61` (Workers
cron path) and `index.ts:152-164` (`runCronSweeps`, EC2/Bun path). No new
cron infrastructure.

Example message (single connector):

> 🔌 Notion's connected. Try:
> "Tell me when the roadmap page changes"

Example message (burst of two):

> 🔌 Notion and Slack are connected. Try:
> • Tell me when the roadmap page changes
> • Summarize unread messages in #general

## Data flow

```text
dashboard connect flow
  user completes OAuth/Composio connect
    → integrations.ts: SELECT existing (userId, provider)?
        ├─ exists (reconnect) → upsert mcpConnections only, no nudge
        └─ new                → upsert mcpConnections
                                 → markConnectorConnected(userId, connectorId)
                                     → user.pendingConnectorNudge upserted
    → redirect to /dashboard?integration_success=<id>
    → ConnectorTile renders with starterPrompts (dashboard surface, immediate)

background sweep (every 60s, worker.ts + index.ts)
  runDueConnectorNudges(now)
    → users where pendingConnectorNudge.dueAt <= now
        → telegram linked? no  → clear pending, skip
        → telegram linked? yes → build message from STARTER_PROMPTS
                                  → sendMessage via telegram-delivery.ts
                                  → clear pending (Telegram surface, ~5min after connect)
```

## Error handling

- `markConnectorConnected` failure: caught and logged, never blocks the
  OAuth redirect (matches `grantConsentIfUndecided`'s existing
  `.catch()` convention right next to it).
- `runDueConnectorNudges`: each user processed independently; one user's
  Telegram-send failure or malformed `pendingConnectorNudge` JSON doesn't
  block the sweep for others (matches `runDueSchedules`'s per-job
  try/catch).
- No Telegram account linked at sweep time: not an error — pending nudge is
  cleared silently, no retry, no dashboard-visible failure state.
- Sweep runs on both `worker.ts` and `index.ts` but only one is active per
  deploy target (Workers vs. EC2/Bun) — no double-send risk, same
  precondition `runDueSchedules` already relies on.

## Testing

- `packages/shared`: a lint-level check (test or script) that every
  `available: true` connector id in `CATALOG_DEFS` has a
  `STARTER_PROMPTS` entry with at least 1 non-empty prompt — prevents the
  catalog and prompt data from silently drifting apart as connectors are
  added.
- `packages/ui-connectors`: `buildCatalog()` populates `starterPrompts`
  from `STARTER_PROMPTS`, defaulting to `[]` for an unmapped id;
  `ConnectorTile` renders the "Try asking Yomi" block only when
  `connected && starterPrompts.length > 0`.
- `apps/backend/src/services/connector-nudge.test.ts`:
  `markConnectorConnected` creates a new pending nudge when none exists;
  appends to `connectorIds` without moving `dueAt` when one already exists;
  a reconnect (existing `mcpConnections` row) never calls
  `markConnectorConnected` at all (asserted from the `integrations.ts`
  route test, not this file). `runDueConnectorNudges`: sends and clears
  for a due, Telegram-linked user; clears without sending for a due,
  unlinked user; leaves not-yet-due users untouched; caps the message at 3
  prompts across a multi-connector batch.
- `apps/backend/src/routes/integrations.test.ts`: a new connect calls
  `markConnectorConnected`; a reconnect (pre-existing row) does not.
- `apps/backend/src/services/schedule-runner.test.ts`: unchanged behavior
  after `telegramChatFor`/`sendTelegram` are extracted to
  `telegram-delivery.ts` — existing tests continue to pass against the
  re-exported/imported helpers.

## Open questions / deliberately deferred

- **Full `STARTER_PROMPTS` copy for all ~51 connectors.** This spec fixes
  the format, the quality bar (grounded in real tool capability, not
  marketing language), and 5 worked examples. Writing the remaining
  entries is implementation work, not a design decision — worth a review
  pass before merge given the volume.
- **5-minute debounce window.** Chosen as a reasonable default (short
  enough to feel connected to the action, long enough to catch a
  multi-connect burst). Not validated against real usage data; easy to
  tune later since it's a single constant in `connector-nudge.ts`.
- **Cross-connector combo prompts** (e.g. "when a Notion page changes,
  post it to Slack" for a user who just connected both) are out of scope —
  the burst message shows one prompt per connector, not prompts that
  combine them. Revisit only if the flat per-connector framing turns out
  to undersell what Yomi can actually do across connected apps.
