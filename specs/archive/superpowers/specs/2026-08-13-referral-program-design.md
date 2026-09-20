# Referral program — design

Status: approved
Date: 2026-08-13

## Problem

Yomi has no referral system today (zero matches for "referral"/"invite"
repo-wide). Folk's referral card (`$25 cash for every friend, cash lands when
a friend subscribes`) is a growth mechanic worth porting, but Folk's specific
implementation doesn't transfer directly:

- Folk pays cash + a free week of Pro; Yomi is pure-credits (`AGENTS.md`
  "Plans & Credits") with no cash-payout rail and no per-feature free-trial
  concept — a credit grant is the only reward primitive that exists.
- Folk identifies users by phone number and refers people straight into an
  iMessage/WhatsApp/Telegram chat. Yomi has no phone-number identity, and
  critically: **Yomi has no Telegram-only signup path at all.** A `user` row
  is only ever created by Better Auth's Google/GitHub OAuth flow (owns
  `user`/`session`/`account`/`verification` per `AGENTS.md`). Telegram is only
  ever *linked* to an already-existing Better Auth user
  (`apps/backend/src/gateway/gateway-runner.ts:753-865`,
  `handleTelegramDeepLink`); a bare `/start` with an unrecognized payload is
  silently discarded (`gateway-runner.ts:1027-1041` only matches pre-minted
  `telegramLinkTokens`, `token.length >= 16`). So a referral flow cannot use a
  raw Telegram deep link to onboard a new user — it has to route through the
  landing page's OAuth signup, which is the actual account-creation event.

## Goal

A user can share a personal referral link from the dashboard. When a
genuinely new person signs up through that link (creates their first Better
Auth account), the referrer is granted credits automatically. Bounded by a
per-user lifetime cap so the mechanic can't be farmed into unlimited free
credits.

## Non-goals

- No reward to the referred friend (referrer-only, confirmed design
  decision — Folk's "free week for them" has no clean Yomi analogue since
  there's no per-feature trial concept, and keeping this one-sided is
  simpler).
- No cash payout, no gift-card integration — credits only, using the
  existing ledger.
- No reward for paid conversion — the trigger is signup, not the friend
  becoming a paying subscriber. (Simpler, accepted trade-off: some referred
  users will never activate or pay; the lifetime cap bounds the downside.)
- No changes to the Telegram linking flow itself
  (`handleTelegramDeepLink`, linking codes) — referral attribution is fully
  resolved before Telegram ever enters the picture.
- No leaderboard, streaks, feature-request bounty, memory import, meeting
  bot, or mini-app marketplace — all deferred to separate future specs (see
  brainstorm scoping decision).

## Architecture

### A. Data model

`user` gains a `referralCode` column (`apps/backend/src/auth-schema.ts`,
alongside other in-place `user` extensions like `agentSoul`): a short unique
slug (8-char base62), generated lazily the first time
`GET /api/referrals/me` is called for a user who doesn't have one yet, then
persisted. One code per user, stable for life, never regenerated.

New `referralEvents` table (`packages/db/src/schema.ts`, alongside
`creditGrants`/`creditTransactions`):

```ts
referralEvents: {
  id: text (pk)
  referrerUserId: text (fk -> user.id)
  referredUserId: text (fk -> user.id, unique)  // first-touch wins, one attribution per new account
  creditsGranted: integer
  createdAt: timestamp
}
```

Unique on `referredUserId` guarantees a given new account is attributed to at
most one referrer, ever — no double-crediting if a code is somehow applied
twice.

Credit issuance reuses the existing `grantCredits()`
(`apps/backend/src/services/credit-ledger.ts:145-214`) with a new
`"referral"` value added to the `CreditGrantSource` union
(`credit-ledger.ts:13-19`). This is a plain TypeScript union addition, not a
migration — `source`/`type` are `text` columns
(`packages/db/src/schema.ts:153`, `:178`), not Postgres enums. Call shape:

```ts
grantCredits({
  userId: referrerUserId,
  amount: 100,
  source: "referral",
  sourceId: referralEvent.id,
  idempotencyKey: `referral:${referralEvent.id}`,
  reason: "referral_bonus",
})
```

`sourceId` + the existing `sourceUnique` constraint on `creditGrants`
(`schema.ts:163-165`) gives idempotency for free — a retried/duplicated call
for the same `referralEvents.id` can't double-grant.

### B. Referral link → signup → attribution

1. Dashboard Referrals tab calls `GET /api/referrals/me`, which lazily
   creates and returns `referralCode` plus stats. Link shown:
   `https://getyomi.in/r/<code>`.
2. New landing route `apps/landing/src/app/r/[code]/page.tsx` (Next.js App
   Router — the only existing dynamic-segment routes today are API proxy
   catch-alls, `app/api/admin/[...path]` and `app/api/billing/[...path]`;
   this is the first public dynamic-slug page). It sets a short-lived cookie
   (`yomi_ref=<code>`, ~30 day expiry, scoped to the apex domain so the
   backend can read it) and redirects to the existing `/signup` page. Landing
   is a Cloudflare Worker that never touches Postgres directly
   (`apps/landing/CLAUDE.md`) — code validation happens backend-side, not
   here.
3. Friend completes Google/GitHub OAuth normally. On the backend's
   post-user-creation path (Better Auth hook or equivalent
   after-create callback — exact hook point is an implementation-plan
   detail, not a design decision):
   - Read the `yomi_ref` cookie from the request. If absent or the code
     doesn't resolve to a user, no-op — this is a normal (non-referred)
     signup.
   - If it resolves: reject (no-op, no grant) if `referrerUserId ===
     newUserId` (self-referral guard — shouldn't be reachable since a code
     only exists for accounts that already exist before this signup, but
     cheap to check defensively).
   - Reject (no-op, no grant) if the referrer has already reached the
     lifetime cap (count existing `referralEvents` rows for
     `referrerUserId` — see cap below).
   - Otherwise: insert the `referralEvents` row, call `grantCredits(...)`.
4. Friend proceeds through normal onboarding (dashboard, Telegram linking,
   etc.) exactly as any other new user — referral attribution is already
   fully settled and independent of whether/when they ever link Telegram.

### C. Abuse guard

Lifetime cap: **20 successful referrals per user (2,000 credits max)**.
Enforced at grant time by counting `referralEvents` rows where
`referrerUserId = X` before inserting the 21st. No separate counter column —
the `referralEvents` table is the source of truth, avoiding a
count-can-drift-from-events bug.

"New users only" is satisfied structurally, not by an extra check: the grant
hook only runs on Better Auth's actual account-creation event, which by
definition only fires once per account. An existing user re-clicking a
referral link and signing in doesn't re-trigger account creation, so no
extra grant is possible.

### D. Dashboard UI

- `SettingsMenu.tsx`'s `DashboardTab` union (`apps/landing/src/components/
  .../SettingsMenu.tsx:17-27`) gains `"referrals"`, plus one entry in the
  menu item array following the existing `{ label, icon, onClick }` shape.
- Tab body lives inline in `dashboard/page.tsx`, gated by
  `activeTab === "referrals"`, matching every other tab's pattern (plain
  `fetch` against `NEXT_PUBLIC_API_URL` with the session bearer token,
  local `useState`/`useEffect` — no SWR/react-query anywhere in this file
  today, no reason to introduce one here).
- Content: referral link with copy button, "X of 20 referrals used,"
  running lifetime credits-earned total, and a plain list of successful
  referrals (date + coarse identifier only — no email/name, matching the
  privacy posture of the rest of the dashboard).
- Backend: new `GET /api/referrals/me` (code/link/count/cap/credits
  earned/event list) in a new `apps/backend/src/routes/referrals.ts`,
  following the existing route-file convention (e.g. `routes/schedules.ts`).

## Data flow

```text
dashboard: user opens Referrals tab
  → GET /api/referrals/me
      → referralCode exists? no → generate + persist
      → return { code, link, count, cap: 20, creditsEarned, events[] }

friend: clicks https://getyomi.in/r/<code>
  → apps/landing app/r/[code]/page.tsx
      → set cookie yomi_ref=<code> (~30d, apex domain)
      → redirect → /signup

friend: completes Google/GitHub OAuth (Better Auth, backend-owned)
  → post-user-creation hook
      → read yomi_ref cookie
          ├─ absent/invalid code        → no-op (normal signup)
          ├─ resolves, self-referral    → no-op
          ├─ resolves, referrer at cap  → no-op
          └─ resolves, eligible         → insert referralEvents row
                                          → grantCredits(referrer, 100, source: "referral")

friend: proceeds through normal onboarding (dashboard, Telegram link)
  → unaffected by referral attribution, already settled
```

## Error handling

- Cookie read failure or missing cookie: treated identically to "no
  referral" — never blocks signup.
- Invalid/expired/unknown referral code: no-op, signup proceeds normally.
  No user-visible error — a friend clicking a stale link just signs up
  without anyone getting credited.
- `grantCredits` failure (e.g. transient DB error): the `referralEvents`
  insert and the credit grant should be one transaction — if the grant
  fails, the event isn't recorded either, so a later manual/automated retry
  isn't blocked by a "no free credits left" phantom cap count. Signup itself
  must never fail or roll back because of a referral-crediting error; this
  step is best-effort relative to account creation, matching the existing
  convention (`grantConsentIfUndecided`'s `.catch()`-logged pattern at the
  connector-connect call site).
- Cap reached mid-race (two friends signing up concurrently near the cap
  boundary): acceptable to grant slightly past 20 in a rare race rather than
  add locking — this is a soft abuse bound, not a billing-critical
  invariant.

## Testing

- `credit-ledger`: `grantCredits` with `source: "referral"` behaves like any
  other source — idempotent on repeated `sourceId`, balance updates
  correctly.
- `referrals` route: `GET /api/referrals/me` generates a code on first call
  and returns the same code on subsequent calls; stats reflect actual
  `referralEvents` rows.
- Referral attribution (wherever the post-user-creation hook lands):
  - Valid code, eligible referrer → event inserted, credits granted once.
  - No cookie / invalid code → no event, signup unaffected.
  - Self-referral → no-op.
  - Referrer already at 20 events → 21st signup gets no grant, no new event.
  - Same `referredUserId` can never produce two `referralEvents` rows
    (unique constraint holds under a retried call).
- Landing `app/r/[code]/page.tsx`: sets cookie and redirects to `/signup`
  regardless of whether the code is valid (validity is checked backend-side
  at signup, not by the redirect page).

## Open questions / deliberately deferred

- **Exact Better Auth hook point for "after user creation."** This spec
  fixes the behavior (read cookie, attribute, grant) but the precise
  mechanism (Better Auth `databaseHooks.user.create.after`, a custom
  callback route, or an application-level check on first request) is an
  implementation-plan decision, to be resolved against Better Auth's actual
  hook surface in this codebase.
- **Reward size (100 credits) and cap (20 referrals / 2,000 credits) are
  product judgment calls**, not derived from any usage model — easy to tune
  later since both are simple constants.
- **What happens to a referral code cookie across an incognito/second
  device signup** (cookie doesn't travel) is accepted as a known gap —
  cross-device attribution is out of scope; the referred friend must
  complete signup in the same browser session that clicked the link.
