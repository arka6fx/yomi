# Leaderboard + profile redesign — design

Status: approved
Date: 2026-08-18

## Problem

The streaks leaderboard shipped 2026-08-14 as opt-in and anonymous
(`specs/archive/superpowers/specs/2026-08-14-streaks-leaderboard-design.md`), a
deliberate privacy-first call given Yomi's positioning as a private
assistant tied to Gmail/Calendar. In practice it's too empty to be fun —
almost nobody opts in, so the leaderboard rarely has anyone on it. The user
wants it visible-by-default instead: everyone shows up automatically, usernames are
manageable from a real profile page (with an uploadable avatar), and each
row shows the user's plan tier, matching the reference screenshot the user
shared.

This walks back part of the prior privacy-first decision — confirmed with
the user (see clarifying Q&A): a hide/unhide escape hatch stays, but the
default flips from "invisible unless you opt in" to "visible unless you
opt out."

## Goal

1. Leaderboard shows every user by default (no opt-in step), each row
   showing rank, avatar, handle, plan badge (Pro/Max), and message count —
   visually closer to the reference screenshot (crown/trophy for #1, progress
   bars).
2. Users can hide themselves from the leaderboard (inverted version of
   today's opt-in toggle).
3. A real Profile page: avatar upload, editable name (defaults from the
   Google account), editable username/handle, and the user's current plan
   — replacing the inline "Leaderboard username" text field that currently
   lives on the Streaks tab.

## Non-goals

- No public/marketing-site leaderboard page — still dashboard-only, behind
  login. Only the opt-in *default* changes, not the "logged-in users only"
  boundary from the prior spec.
- No clickable per-row navigation to other users' profiles — confirmed
  with the user. The "profile" ask is about the viewer's own profile only.
- No image cropping/resizing UI — upload stores the file as-is (subject to
  a size cap and image-type validation); display is a CSS `object-fit:
  cover` circle, same as the existing avatar rendering.
- No change to how streaks/message-count math works
  (`recordDailyActivity` in `services/streaks.ts` is untouched).
- No renaming of the `leaderboardOptIn` column — its meaning flips (opt-in
  → visible-unless-hidden) but it's reused in place rather than replaced,
  matching this codebase's in-place-extension convention.

## Architecture

### A. Data model

`user` gains one column (`apps/backend/src/auth-schema.ts`), plus a
semantic change to an existing one:

- `customAvatarKey: text` (nullable) — S3 object key for an uploaded
  avatar, distinct from `image` (the Google OAuth photo). Kept separate
  because Better Auth writes `image` from the Google profile on every
  sign-in; if a custom upload lived in `image` it would be silently wiped
  out on the user's next login. Display precedence: `customAvatarKey` →
  `image` → generic icon (already the fallback in `Avatar` in
  `StreaksManager.tsx`).
- `leaderboardOptIn` (existing column): default flips from `false` to
  `true` for new rows. A migration backfills existing rows to `true` so
  current users become visible immediately rather than staying hidden
  under the old semantics. The column now means "visible on the
  leaderboard," and the Streaks tab's toggle label inverts to "Hide me
  from the leaderboard."
- `leaderboardHandle` (existing column): today it's only populated lazily
  on first opt-in. Since every user is visible now, every user needs a
  handle. The migration backfills a generated handle
  (adjective-noun-suffix, same generator as today) for any row where it's
  currently null. Going forward, `recordDailyActivity` (first message a
  user ever sends) generates a handle if one doesn't exist yet, so the
  lazy-generate-on-opt-in code path in `setLeaderboardOptIn` is deleted —
  opting in/out no longer touches the handle at all.

No new table — consistent with the prior spec's precedent of extending
`user` in place for this feature.

### B. Avatar upload + serving

Reuses the existing S3 client and validation helpers in
`apps/backend/src/services/asset-storage.ts` (`resolveAssetType`,
content-type sniffing) rather than building a new upload pipeline, but:

- New key prefix `avatars/{userId}/{uuid}.ext`, distinct from the existing
  `assets/{userId}/...` prefix used for transient Telegram attachments.
  **This prefix must be excluded from the bucket's 30-day lifecycle
  deletion rule** — an AWS console/IaC change outside this repo's code,
  called out explicitly as a manual step before this ships (avatars must
  not expire).
- New `uploadAvatar(userId, bytes, contentType): Promise<{ key: string } |
  null>` in `asset-storage.ts`, mirroring `uploadAsset` but writing to the
  `avatars/` prefix and skipping the presigned-URL step (avatars are
  served through a stable proxy route, not a presigned link — presigned
  URLs expire in an hour, which doesn't work for a URL embedded in
  leaderboard rows viewed by many users over time).
- New route `POST /api/user/avatar` (authenticated, in
  `apps/backend/src/routes/user.ts` or wherever `PATCH /api/user/profile`
  currently lives): accepts raw image bytes, validates content-type
  (image/jpeg, image/png, image/gif, image/webp only) and a size cap
  (5MB), calls `uploadAvatar`, persists the returned key to
  `customAvatarKey`, returns the new avatar's serving URL.
- New route `GET /api/avatars/:userId` (authenticated — consistent with
  the rest of the dashboard API being behind login, not because the image
  itself is sensitive): looks up `customAvatarKey` for that user, 404s if
  none, otherwise streams bytes via the existing `fetchAsset` and sets a
  long `Cache-Control` (each upload gets a fresh UUID key, so caching a
  given URL forever is safe).

### C. Backend routes (streaks + profile)

- `GET /api/streaks/leaderboard`: same query shape, `leaderboardOptIn =
  true` now reads as "not hidden." Each entry gains `plan: "explore" |
  "pro" | "max"` (already available on `user.plan`, just not currently
  selected/returned).
- `POST /api/streaks/opt-in`: unchanged wire shape (`{ optIn: boolean }` →
  `{ leaderboardOptIn, leaderboardHandle }`), but the Streaks tab now calls
  it to mean hide/unhide rather than join/leave.
- `POST /api/streaks/handle` and `POST /api/streaks/show-photo`: removed
  from `streaksRouter`. Their logic (`updateLeaderboardHandle`,
  `setLeaderboardShowPhoto` in `services/streaks.ts`) is kept as-is and
  called from the profile route instead, since editing your handle/photo
  visibility is now a profile action, not a streaks action.
- `PATCH /api/user/profile`: gains `handle` and `showPhoto` fields
  alongside whatever it already accepts (e.g. `agentSoul`), delegating to
  the same `updateLeaderboardHandle` / `setLeaderboardShowPhoto` service
  functions.

### D. Profile page

Enhances the existing `activeTab === "profile"` block in
`apps/landing/src/app/dashboard/page.tsx` (no new route/page, per the
"my own profile only" decision):

- Avatar: shows `customAvatarKey` → `image` → generic icon (reusing the
  `Avatar` component pattern from `StreaksManager.tsx`). Clicking it opens
  a file picker; on select, uploads via `POST /api/user/avatar` and
  updates the displayed avatar immediately.
- Name: defaults to `session.user.name` (already the Google account name;
  currently just displayed, not editable) — made editable via the
  existing `PATCH /api/user/profile` (Better Auth's own `name` field, not
  a new column).
- Username/handle: the input+save control currently in
  `StreaksManager.tsx` moves here verbatim (same
  `updateLeaderboardHandle` validation and error messaging), now saved via
  `PATCH /api/user/profile`.
- Photo visibility toggle (`leaderboardShowPhoto`) moves here too, next to
  the avatar.
- Plans: a compact version of the plan cards already rendered in the
  Billing tab (reusing `PLANS` from `@/lib/plans`), showing the current
  plan highlighted, with a link to the Billing tab for upgrades rather
  than duplicating the full upgrade flow.

`StreaksManager.tsx` loses the username input, the show-photo toggle, and
the "Opt in"/"Opted in" button becomes "Hide me from the leaderboard" /
"Hidden", plus a small `Edit profile →` link (using the existing
`onNavigate` callback pattern already passed into other dashboard
components) that switches `activeTab` to `"profile"`.

### E. Leaderboard visual redesign

Presentation-only change to the leaderboard block in
`StreaksManager.tsx`, no new data beyond the `plan` field from §C:

- Rank number, with a trophy icon replacing the number for rank #1
  (matching the reference screenshot).
- Avatar (existing `Avatar` component, already used here).
- Handle, plan badge pill next to it (small rounded label, "PRO"/"MAX",
  omitted entirely for `explore` — same visual language as the `PLANS`
  badges already used in the Billing tab, just condensed).
- A horizontal progress bar scaled to `entry.totalMessagesSent /
  topEntry.totalMessagesSent`, sitting behind or beside the message count,
  purely decorative (the reference screenshot uses this to convey relative
  standing at a glance).
- "Active today" / "resting" style relative-activity caption is **not**
  included — there's no `lastActiveDate` exposed via the leaderboard
  endpoint today and adding it is out of scope; the redesign works with
  the fields already returned plus `plan`.

### F. Testing

- `services/streaks.test.ts`: update existing opt-in tests for the
  inverted default (new rows visible by default); add a test that
  `recordDailyActivity` generates a handle on a user's first-ever message
  when one doesn't exist; add a migration-adjacent test or a one-off
  script check that backfill covers all pre-existing null-handle rows (if
  the migration is a raw SQL script, this is a manual verification step
  instead of a unit test).
- `getLeaderboard` test: assert the new `plan` field is present and
  correctly sourced per user.
- New route test for `POST /api/user/avatar`: rejects non-image
  content-types, rejects payloads over the size cap, accepts a valid PNG
  and persists `customAvatarKey`.
- `GET /api/avatars/:userId`: 404s when no custom avatar exists, streams
  bytes with correct content-type when one does.

## Error handling

- Avatar upload failure (S3 error, invalid type, oversized payload):
  surfaced as a 4xx/5xx from `POST /api/user/avatar` with a clear message;
  the Profile page shows the error inline and leaves the previous avatar
  displayed (no partial/broken state).
- `GET /api/avatars/:userId` when `customAvatarKey` is null: 404, and the
  frontend `Avatar` component already falls back to `image` or the
  generic icon on any fetch failure (existing `onError` handling), so no
  new client-side error path is needed.
- Handle backfill collision during migration (astronomically unlikely,
  same reasoning as the original spec): retry with a new random suffix, a
  small fixed number of times, matching `setLeaderboardOptIn`'s existing
  retry pattern.

## Migration plan

New migration `0041_leaderboard_default_visible.sql`:
1. Add `custom_avatar_key text` to `user`.
2. Alter `leaderboard_opt_in` column default to `true`.
3. `UPDATE "user" SET leaderboard_opt_in = true WHERE leaderboard_opt_in =
   false` (backfill existing rows to visible).
4. Backfill `leaderboard_handle` for any row where it's null, via a
   one-off script (not raw SQL, since handle generation needs
   collision-retry logic) run once after the migration lands — same
   pattern as other data-backfill work in this codebase
   (`bun run db:migrate` for schema, then a script for data).

## Open questions / deliberately deferred

- **Bucket lifecycle rule exclusion for `avatars/`** is an AWS
  console/IaC change outside this repo — must be confirmed/applied before
  this ships, called out in §B. Implementation can proceed in parallel
  (uploads will just also expire after 30 days like other assets until
  the rule is fixed), but this is a hard blocker for calling the feature
  done.
- **Avatar size cap (5MB) and allowed types** are product judgment calls,
  easy to tune later.
- **Handle word-list content** — unchanged from the original spec, still
  an implementation-time content task, not this design's concern.
