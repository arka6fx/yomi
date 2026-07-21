# Settings Menu — Design

Date: 2026-07-22
Status: Approved (design); pending implementation plan

## Summary

Add a gear-icon settings menu to the dashboard header, loosely inspired by
a competitor's settings panel (structure only — layout pattern, never
their name/copy/logo). Absorbs the current dashboard's sprawling
`"account"` tab (Telegram card + billing warnings + plans, all stacked in
one long scroll) and the standalone `"privacy"` tab into a proper menu,
and ships one new feature that was already 90% built: **writing style**,
via the existing-but-unwired `agentSoul` field and `PATCH
/api/user/profile` route.

This is the 4th of 5 UI-redesign sub-projects from the original request
(connections page, post-signup screen, and custom MCP servers already
done — the last two, dashboard home page and docs redesign, remain
after this).

## Scope (v1)

- **In scope:** the `SettingsMenu` component and header trigger, tab
  restructuring (`"account"` splits into `"billing"`/`"profile"`/
  `"writing-style"`, `"privacy"` moves into the menu, everything else
  unchanged), wiring writing style end-to-end (backend route extension +
  new UI section).
- **Out of scope, no backend hook exists for any of these today:** maps
  provider selector (and there's no 2GIS connector at all — only Google
  Maps), language selector, quiet check-ins (idle-time-triggered nudges —
  different trigger model than the existing fixed-schedule `schedules`
  table), meeting recaps (no Google Meet recording/transcript detection
  exists), call settings, referrals, FAQ.
- **Out of scope, deliberately deferred within "Profile":** editing the
  display name. `PATCH /api/user/profile` already supports it and the
  route gets touched anyway for writing style, but wiring a rename UI is
  explicitly not part of this round — Profile is read-only (name + email)
  for now.

## Design

### 1. `SettingsMenu` component (new, `apps/landing/src/components/dashboard/SettingsMenu.tsx`)

Follows the existing sibling-component convention in this directory
(`MemoryManager`, `PrivacyManager`, `SchedulesManager`,
`ConversationManager`, `StatusManager` — all Tailwind, not the
`ui-connectors` inline-style system, since this is dashboard-page UI, not
a portable connector widget). A gear icon (`Settings` from `lucide-react`,
not yet imported in `dashboard/page.tsx`) in the header opens a dropdown
panel with two groups:

```
Connections     →  setActiveTab("integrations")
Developer       →  navigate to /dashboard/developer (existing page)
Memory          →  setActiveTab("memory")
Profile         →  setActiveTab("profile")           [new]
Writing style   →  setActiveTab("writing-style")      [new]
─────────────────────────────────────────────
Account
Billing         →  setActiveTab("billing")
Privacy         →  setActiveTab("privacy")
Docs            →  external link to /docs
```

Closes on: item click, click-outside, Escape. Props: `activeTab`,
`onNavigate: (tab: ActiveTab) => void` (calls `setActiveTab` and closes
the menu), `onDeveloperClick`, `onDocsClick`, and whatever session/user
display data the header already has (email, owner badge) — no new data
fetching, purely a navigation shell around state the page already holds.

### 2. Tab restructuring (`apps/landing/src/app/dashboard/page.tsx`)

The `activeTab` union type gains `"billing"`, `"profile"`, and
`"writing-style"`, and loses `"account"` (split three ways). `"privacy"`
stays as a valid tab value — only *how it's reached* changes, not its
rendering block, which is untouched.

The flat tab-bar array shrinks from `["account", "integrations",
"memory", "schedules", "conversation", "status", "privacy"]` to
`["integrations", "memory", "schedules", "conversation", "status"]` —
gear-menu items entirely replace direct tab-bar access to the removed
five destinations (`account`'s three-way split, plus `privacy`, plus the
two genuinely new ones).

The old `activeTab === "account"` block's content splits along its
existing internal structure (already three visually distinct pieces
stacked in one scroll — this isn't a rewrite, just relocating existing
JSX into three separate `activeTab === "..."` conditionals):
- Telegram card + welcome banner → `activeTab === "profile"` (profile is
  where "how do I use Yomi / connect Telegram" naturally lives alongside
  the read-only name/email — closer to what a user expects under
  "Profile" than under "Billing")
- Billing warnings + plans + usage → `activeTab === "billing"`
- (Writing style has no existing content to relocate — it's new.)

### 3. Writing style (backend: extend `PATCH /api/user/profile`, `GET /api/user/me`)

`apps/backend/src/routes/profile.ts`'s `ProfileBody` type gains an
optional `agentSoul?: string`. The route accepts either field
independently (not both required) — updating just `agentSoul` must not
require also resending `name`. `GET /me`'s response gains `agentSoul` in
its returned fields, so the frontend can pre-fill the textarea with the
current value on load. Both changes are additive to the existing route,
not a new one — and both get covered by extending
`apps/backend/src/routes/profile.test.ts`'s existing `fakeDb` +
`app().request()` pattern (already proven in that exact file), not a new
testing approach.

### 4. Writing style (frontend, new `activeTab === "writing-style"` block)

A small section: fetches the current `agentSoul` via `GET /api/user/me`
on first visit to the tab (or on mount, matching this page's existing
fetch-on-mount convention elsewhere), a `<textarea>` bound to it, a Save
button calling `PATCH /api/user/profile` with `{ agentSoul }`. No new
component file needed — small enough to inline in `page.tsx` alongside
the other small tab blocks (`billing`/`profile`), matching how e.g. the
`privacy`/`memory` tabs each just render their one manager component
inline.

## Testing

- **Backend**: `profile.test.ts` gains cases for updating `agentSoul`
  alone, updating both fields together, and `GET /me` returning
  `agentSoul` — using the file's existing `fakeDb` mock, no new test
  infrastructure.
- **Frontend**: no automated test — `apps/landing` has no test harness for
  client-rendered pages (confirmed across every prior UI feature this
  session). Verify with typecheck + lint; manual verification needs a
  real signed-in session (this sandbox's dev environment can't reach the
  backend/DB — the same limitation hit on every UI feature this session).
