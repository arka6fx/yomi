# Streaks & leaderboard — design

Status: approved
Date: 2026-08-14

## Problem

Yomi has no streak or leaderboard concept today (zero matches for
"streak"/"leaderboard" repo-wide). Folk's homescreen banner ("start a
streak") and public "who folks the hardest" leaderboard are engagement
mechanics worth porting, but Folk's specific implementation doesn't
transfer directly:

- Folk's leaderboard is a **public** page on the marketing site, ranking
  strangers by a substance-weighted "yaps" score, with optional real
  usernames. Yomi is a private productivity assistant tied to a user's
  Gmail/Calendar/work data — a public cross-user ranking doesn't fit that
  positioning, and Yomi's dashboard already has an explicit
  consent/privacy posture (PII redaction, `services/privacy/*`) that a
  Folk-style public leaderboard would cut against.
- Yomi has no username/handle system (`user` table has only `name`/`email`,
  both tied to the real OAuth identity) and no existing lifetime message
  counter — the daily-reset columns that exist on `user`
  (`dailyChatCount`, `agentUsageCount`, etc.) turned out to be **dead
  code**: nothing in `apps/backend/src` writes to them, since the credits
  system (`services/metering.ts`) superseded them without removing the
  columns. Neither a handle nor a running total exists to build on.

## Goal

1. **Streaks:** track consecutive days a user has messaged Yomi, shown
   privately in their own dashboard.
2. **Leaderboard:** an opt-in, anonymous, dashboard-only ranking of total
   messages sent, visible to any logged-in user but only populated by
   users who've opted in.

Both are cosmetic — no credit rewards, no gating of functionality.

## Non-goals

- No public/marketing-site leaderboard page — dashboard-only, behind
  login (confirmed design decision: doesn't fit Yomi's private-assistant
  positioning).
- No substance-weighted scoring ("yaps") — ranking is a plain count of
  qualifying messages. Simpler, and Yomi has no existing signal for
  "message substance" to build on.
- No credit rewards for streak milestones — purely cosmetic for this
  round (confirmed decision; easy fast-follow later since the streak
  state already exists once built).
- No custom/editable leaderboard handles — auto-generated only. Avoids
  building any validation/moderation surface for user-supplied public
  strings, and avoids resurrecting the "does Yomi have usernames"
  question this spec deliberately answers "no" to.
- No resurrection of the dead `dailyChatCount`/`dailyVoiceCount`/
  `dailyImageCount`/`agentUsageCount` columns — new counters are added
  instead; cleaning up the dead columns is a separate, unrelated concern.
- No 30-day leaderboard toggle — all-time only for this round (confirmed
  decision; cheap to add later since it's just an additional date filter
  on the ranking query).

## Architecture

### A. Data model

`user` gains six columns (`apps/backend/src/auth-schema.ts`, following the
same in-place-extension convention as `agentSoul`/`referralCode`):

- `currentStreak: integer` (default 0)
- `longestStreak: integer` (default 0)
- `lastActiveDate: text` (nullable, `YYYY-MM-DD`, UTC — mirrors the
  existing `dailyResetDate` column's format convention even though that
  column itself is dead code)
- `totalMessagesSent: integer` (default 0) — the leaderboard's ranking
  metric
- `leaderboardOptIn: boolean` (default false)
- `leaderboardHandle: text` (nullable) — auto-generated the first time a
  user opts in, never derived from `name`/`email`, stable thereafter even
  if the user opts out and back in

No new table — this is scalar per-user state, matching the precedent set
by every other in-place `user` extension in this codebase.

### B. Update hook

A single hook point: `GatewayRunner.onIncoming`
(`apps/backend/src/gateway/gateway-runner.ts`), immediately after a
message is confirmed to belong to an authenticated, platform-linked user
(the point where `yomiUserId` is resolved, before any billing/metering
logic runs). This is deliberately **not** hooked into
`services/metering.ts`'s `chargeUsage()` chokepoint: that pipeline has its
own charge/skip semantics (a resumed agent turn can skip a charge, one
incoming message can produce zero, one, or two `usageEvents` rows) that
don't line up with the plain, user-facing question "did you talk to Yomi
today" — using it would make the streak trigger silently diverge from
what a user actually did.

New `recordDailyActivity(userId: string): Promise<void>` in a new
`apps/backend/src/services/streaks.ts`, called once per qualifying
incoming message:

1. Always increment `totalMessagesSent` by 1.
2. Compute today's date in `YYYY-MM-DD` (UTC).
3. If `lastActiveDate === today`: streak already counted today, no
   further change.
4. If `lastActiveDate === yesterday`: `currentStreak += 1`.
5. Otherwise (first message ever, or a gap of 2+ days):
   `currentStreak = 1`.
6. `longestStreak = max(longestStreak, currentStreak)`.
7. Set `lastActiveDate = today`.

Best-effort, not wrapped in a transaction or row lock — a user can only
plausibly send concurrent messages from the same Telegram account in a
narrow race window, and the worst case (a day's increment lost or
double-counted) is cosmetic, not billing-relevant. This mirrors the
referral program's precedent for accepting soft inconsistency on
non-critical counters rather than adding locking.

### C. Leaderboard opt-in and handle generation

`setLeaderboardOptIn(userId: string, optIn: boolean): Promise<{ leaderboardHandle: string | null }>`
in `services/streaks.ts`:

- Opting in for the first time (`leaderboardHandle` is null): generate an
  anonymous handle (adjective-noun-suffix pattern, e.g.
  `quiet-falcon-3f2a` — word lists plus a short random suffix via
  `randomBytes`, matching this codebase's existing `randomBytes(...).toString("hex")`
  convention for short codes) and persist both the handle and
  `leaderboardOptIn = true`.
- Opting in again after a prior opt-out: reuse the existing handle,
  just flip `leaderboardOptIn` back to `true`. A user's handle is stable
  for their account's lifetime once generated, even across opt-out/back-in
  cycles — avoids a confusing "your handle changed" experience and avoids
  needing to reconcile stale references anywhere.
- Opting out: `leaderboardOptIn = false`, handle left in place (unused
  until they opt in again).

### D. Backend route

`GET /api/streaks/me` → `{ currentStreak, longestStreak, totalMessagesSent, leaderboardOptIn, leaderboardHandle }`.

`POST /api/streaks/opt-in` (body `{ optIn: boolean }`) →
`{ leaderboardOptIn, leaderboardHandle }`.

`GET /api/streaks/leaderboard` → `{ entries: { rank, handle, totalMessagesSent, isYou }[], yourRank: number | null }`.
Query: users where `leaderboardOptIn = true`, ordered by
`totalMessagesSent` desc, limited to top 50. If the requesting user is
opted in but outside the top 50, their own row is appended separately
(computed via a count-of-users-with-a-higher-score query) so they can
always see their position, matching Folk's pattern of always surfacing
"you are here" even off the visible top of the list.

### E. Dashboard

New `"streaks"` tab in `SettingsMenu.tsx`'s `DashboardTab` union, same
menu-registration pattern as the Referrals tab. Tab body
(`StreaksManager.tsx`, matching `ReferralsManager.tsx`'s plain
fetch/`useState` convention): current streak with a flame-style
indicator, longest streak, total messages sent, an opt-in toggle, and —
when opted in, or always-visible read-only if not — the leaderboard
table with the viewer's own row highlighted. Any logged-in user can view
the leaderboard; only opted-in users appear on it.

## Data flow

```text
message arrives (Telegram, linked user)
  → GatewayRunner.onIncoming
      → yomiUserId resolved
          → recordDailyActivity(yomiUserId)
              → totalMessagesSent += 1
              → streak math (see Architecture §B) against lastActiveDate
      → (existing billing/metering pipeline runs independently, unaffected)

dashboard: user opens Streaks tab
  → GET /api/streaks/me → current/longest streak, total messages, opt-in state
  → GET /api/streaks/leaderboard → top 50 opted-in users + viewer's own rank

user toggles "Join the leaderboard"
  → POST /api/streaks/opt-in { optIn: true }
      → handle exists? no → generate + persist
      → leaderboardOptIn = true
  → tab re-fetches /api/streaks/me and /api/streaks/leaderboard
```

## Error handling

- `recordDailyActivity` failure (e.g. transient DB error): logged and
  swallowed, never blocks message processing — this hook sits in the
  incoming-message hot path and must not be able to break normal Yomi
  usage over a cosmetic feature.
- Leaderboard query returning zero opted-in users (early days of the
  feature, or everyone opts out): return `{ entries: [], yourRank: null }`,
  not an error — the dashboard shows an empty/"nobody's opted in yet"
  state.
- Handle generation collision (astronomically unlikely given the random
  suffix, but the same defensive pattern as the referral program's code
  generation): retry a small fixed number of times, then surface a 500
  rather than silently persisting a colliding handle.

## Testing

- `streaks` service: `recordDailyActivity` — first-ever message sets
  streak to 1; a message the next UTC day increments; a message the same
  UTC day is a no-op on the streak (but still increments
  `totalMessagesSent`); a gap of 2+ days resets to 1; `longestStreak`
  never decreases.
- `setLeaderboardOptIn`: first opt-in generates and persists a handle;
  opting out then back in reuses the same handle; opting in twice in a
  row doesn't regenerate the handle.
- `getLeaderboard`: ranks opted-in users correctly by
  `totalMessagesSent`; excludes non-opted-in users entirely; correctly
  computes and appends the viewer's own rank when they're outside the
  top 50; returns an empty list cleanly when nobody's opted in.
- `routes/streaks.ts`: `POST /opt-in` requires authentication and only
  ever touches the caller's own row (no user-supplied `userId` in the
  body).

## Open questions / deliberately deferred

- **Handle word-list content** is an implementation-time content task —
  this spec fixes the format (adjective-noun-suffix) and the "never
  derived from real identity" constraint, not the actual word lists.
- **Whether `onIncoming` fires for every message type** (including bare
  slash commands like `/help`, not just conversational turns) needs
  confirming against the actual `GatewayMessage` shape at implementation
  time — this spec's intent is "any message from a linked user," matching
  the already-approved streak-trigger definition, but the exact set of
  message kinds that reach `onIncoming` before being filtered elsewhere
  is a plan-time detail.
- **Leaderboard cap of 50** and the streak-math constants are product
  judgment calls, not derived from a usage model — simple to tune later.
