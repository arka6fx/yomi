# Suggested Automations — Design

Date: 2026-07-07
Status: Approved (design); pending implementation plan

## Summary

Yomi becomes proactive: when a user connects an integration, the app offers the
obvious automations for it as one-tap suggestions ("Daily 8am inbox briefing?").
Accepting creates a real schedule through the existing schedules engine;
dismissing latches the suggestion so it is never re-offered. Modeled on
hermes-agent's consent-first suggestion surface, reduced to its essential
mechanic: suggestions are **computed** (catalog × connected integrations minus
decisions), not stored.

## Scope (v1)

- **Sources:** a static, code-versioned catalog, surfaced per connected
  connector. No usage mining, no LLM analysis, no blueprint/skill sources.
- **Surface:** desktop Integrations page only. No Telegram push, no in-chat
  mentions.
- **Acceptance target:** the existing backend `schedules` engine
  (`routes/schedules.ts` + `services/schedule-runner.ts`); no second automation
  engine.

Out of scope for v1: usage-based suggestions, Telegram/inline acceptance,
suggestion analytics, per-suggestion customization before accept (the user can
edit the created schedule afterward via existing schedule management).

## Architecture

A suggestion "exists" only as a computation:

```
offerable(user) = CATALOG
  × user's connected integrations (mcp_connections)
  × prerequisite check (e.g. Telegram linked, for entries delivering there)
  − suggestion_decisions rows (accepted or dismissed)
```

| Unit | Responsibility |
| --- | --- |
| `apps/backend/src/services/suggestions/catalog.ts` | Static catalog entries + `offerableFor(userId)` computation |
| `apps/backend/src/routes/suggestions.ts` | `GET /`, `POST /:dedupKey/accept`, `POST /:dedupKey/dismiss` |
| `suggestion_decisions` table | The only persistence: accepted/dismissed latches |
| Desktop Integrations page section | Cards with Enable / Dismiss via the existing IPC bridge pattern |

### Catalog entry shape

```ts
interface SuggestionEntry {
  dedupKey: string        // versioned, e.g. "gmail-daily-briefing-v1"
  provider: string        // mcp_connections provider that must be connected
  title: string
  description: string
  requires?: { telegram?: boolean }
  spec: {
    schedule: string      // existing phrase syntax, e.g. "every day 9am"
    prompt: string        // agent prompt run by schedule-runner
    deliverTo: string[]   // e.g. ["telegram"]
  }
}
```

v1 catalog (~5 entries; final copy at plan time):
- Gmail: daily inbox briefing (9am)
- Google Calendar: morning agenda (8am)
- Google Drive: weekly digest of new files in indexed folders
- GitHub: daily notifications digest
- Generic: daily check-in

`dedupKey` is versioned so a materially reworded suggestion can be re-offered
deliberately by bumping the suffix; dismissals latch per key.

## Data model

One new table (migration `0027`, registered in `drizzle/meta/_journal.json`):

```sql
CREATE TABLE suggestion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  dedup_key text NOT NULL,
  decision text NOT NULL,          -- 'accepted' | 'dismissed'
  schedule_id uuid,                -- set on accept
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedup_key)
);
```

**Deploy note:** merging to main deploys code only — run
`cd packages/db && bun --env-file=../../.env run db:migrate` after merge
(the live DB was found 3 migrations behind on 2026-07-07; do not repeat that).

## API

All routes `authenticate`d; mounted at `/api/suggestions`.

- `GET /` → `{ suggestions: [{ dedupKey, title, description, schedulePreview }] }`
  — computed as above. Entries whose `requires.telegram` is unmet are hidden
  (not shown-but-disabled), so accepting never creates a schedule that cannot
  deliver.
- `POST /:dedupKey/accept` → validates the key is currently offerable for this
  user, creates the schedule **reusing the same parsing and plan-limit logic as
  `POST /api/schedules`** (`parseSchedule`, `scheduleLimitForPlan`), inserts the
  decision row with `scheduleId`, returns `{ scheduleId }`. The unique
  constraint makes a double-accept idempotent (409/no-op). Plan limit exceeded
  → same error shape as the schedules route.
- `POST /:dedupKey/dismiss` → inserts the latch, returns `{ ok: true }`.
  Dismissed keys are never re-offered, including after disconnect/reconnect.

## Desktop UI

A "Suggested automations" section on the Integrations page, rendered when
`GET /api/suggestions` returns entries. Card: title, description, schedule
preview, **Enable** and **Dismiss** buttons. Uses the same main-process IPC
bridge pattern as the Drive indexed-folders section (renderer → preload →
main → backend with bearer token). On action, refetch the list. Errors render
inline (plan limit → "schedule limit reached for your plan").

## Edge cases

- Disconnecting a connector hides its unaccepted suggestions (computed), but
  accepted schedules remain — the user manages them via existing schedule UI.
  (A schedule whose connector is gone fails at run time with the existing
  connector-not-connected error; that behavior is unchanged.)
- Telegram unlinked: telegram-delivery entries hidden entirely.
- Accept raced twice: unique constraint; second call returns the existing
  decision without creating a second schedule.
- Accept for a key that is not offerable (dismissed, unknown, or connector not
  connected) → 404/409 with a code, never a silent create.

## Cost & plans

No new credit surface: accepted schedules run and charge exactly as
user-created schedules do today. Schedule count limits per plan
(`scheduleLimitForPlan`) apply to accepts identically.

## Testing

- **Unit (catalog):** offerable computation — provider connected/unconnected;
  telegram-gated entry hidden/shown; decided keys excluded; versioned key
  re-offer.
- **Routes** (mirroring `rag-drive.test.ts` mock patterns): GET excludes
  decided + unconnected; accept creates schedule + decision (assert both rows)
  and honors the plan limit path; dismiss latches; double-accept idempotent;
  non-offerable accept rejected.
- **Desktop:** manual verification (connect a connector → cards appear →
  Enable creates a schedule visible in schedule list → Dismiss hides
  permanently).

## Future (explicitly deferred)

Usage-based suggestions, Telegram push with inline accept, in-chat conversational
offers, suggestion analytics. All can write into the same catalog/decisions
shape — nothing in v1 blocks them.
