# Dashboard Home Page — Design

## Context

The dashboard currently defaults to the "Integrations" tab. The tab bar is
`integrations | memory | schedules | conversation | status`, with
`profile | billing | writing-style | privacy` reachable only via the gear-icon
`SettingsMenu` added for the settings-menu feature. There is no overview/landing
view — a user signs in and lands directly on the connector marketplace.

This is the fifth and final UI-redesign sub-project from the original combined
request (connections page, post-signup screen, custom MCP servers, and settings
menu all shipped this session). The reference is a third-party competitor
product's dashboard home screen — used for structural/UX inspiration only; no
names, logos, or copy are carried over.

The reference screen has: a greeting with date + weather, four stat cards
(history / automations / activity / meetings) each with a one-line summary and
an empty state, a memory panel, and a footer row (invite-a-friend, feedback).

## Goals

- Give the dashboard a proper landing view that summarizes account state at a
  glance and links out to the detail tabs.
- Reuse existing backend endpoints only — this is a frontend-only change.
- Match the reference's structure where Yomi has real data to back it; drop
  elements with no backend hook rather than faking them.

## Scope decisions

- **Weather: dropped.** No weather API integration or stored user location
  exists in Yomi today. The existing page-level greeting ("Hey, {name}.") stays
  as-is — date/weather is not added.
- **Meetings card: dropped.** No meetings/meeting-recap feature exists
  anywhere in the codebase. Ships with 3 stat cards instead of 4: History,
  Automations, Activity.
- **Invite-a-friend / referrals: dropped.** No referral tracking exists in
  Yomi. The footer keeps a single feedback link only.
- **Default tab: changes to `home`.** This supersedes the `integrations`
  default set during the settings-menu feature — a dashboard's landing view
  should be the overview, not the connector marketplace.

## Architecture

A new `activeTab: "home"` is added to `DashboardTab`
(`apps/landing/src/components/dashboard/SettingsMenu.tsx`) and becomes the
`useState` default in `apps/landing/src/app/dashboard/page.tsx` (replacing
`"integrations"`). It's added as the first entry in the tab-bar array
(`page.tsx`'s `["integrations", "memory", "schedules", "conversation",
"status"]` list), so a user can navigate back to it after visiting other tabs.

A new sibling component, `apps/landing/src/components/dashboard/DashboardHome.tsx`,
follows the existing convention of `MemoryManager.tsx` / `ConversationManager.tsx`
/ `SchedulesManager.tsx`: a `"use client"` component taking `{ token }` (or
`{ token, onNavigate }` where card clicks need to switch tabs), self-fetching
its own data on mount, Tailwind styled to match the card/panel patterns already
established in those sibling components (`rounded-2xl border border-border
bg-card p-5 sm:p-6`, icon-in-rounded-square headers, `Loader2` loading states,
dashed-border empty states).

The existing page-level greeting (`page.tsx:730-739`, "Hey, {name}." + "Your
Yomi account overview.") is unconditional today — shown above the tab bar
regardless of `activeTab`. It is left unchanged; no home-specific greeting is
added inside `DashboardHome`.

## Stat cards

Three cards, laid out in a row (stacking on narrow screens, matching
`ConnectorMarketplace`'s existing responsive patterns). Each card is a
`<button>` that calls `onNavigate(tab)` to switch `activeTab`, mirroring
`NextStepCard`'s existing click-to-navigate pattern.

### History

- **Data:** `DashboardHome` fetches `GET /api/conversation/shared` on mount —
  the same endpoint `ConversationManager` already uses. Response shape:
  `{ history?: Array<{ role: "user" | "assistant" | "system"; content: string }> }`.
- **Summary line:** the last `role === "user"` turn's `content`, truncated to
  ~80 characters, plus the total non-system turn count (e.g. "12 messages").
- **Empty state:** "No conversation yet" — shown when `history` is empty or
  absent.
- **Click target:** `conversation` tab.

### Automations

- **Data:** `GET /api/schedules` — the same endpoint `SchedulesManager` already
  uses. Response shape: `{ schedules: ScheduleRow[] }` where `ScheduleRow` has
  `enabled: boolean`, `nextRunAt: string | null`, `prompt: string`.
- **Summary line:** `"{enabledCount} of {totalCount} active"`, plus the
  soonest `nextRunAt` among enabled schedules, formatted relative
  (e.g. "next run in 3h") if present.
- **Empty state:** "No automations yet" — shown when `schedules` is empty.
- **Click target:** `schedules` tab.

### Activity

- **Data:** reuses `UsageSummary.recentActivity`, which is already fetched at
  the `DashboardContent` page level (`page.tsx:277`, unconditional on mount,
  independent of `activeTab`) — **no new fetch**. Shape:
  `Array<{ id: string; label: string; category: string; credits: number;
  createdAt: string }>`. `DashboardHome` receives this as a prop
  (`recentActivity: UsageSummary["recentActivity"]`) rather than fetching it
  itself.
- **Summary line:** the most recent entry's `label`, plus a relative time from
  `createdAt` (e.g. "2h ago").
- **Empty state:** "No activity yet" — shown when the array is empty.
- **Click target:** `billing` tab, where the full `recentActivity` list
  already renders (`page.tsx:1526-1550`).

## Memory panel

Below the stat cards, a preview panel. `DashboardHome` fetches
`GET /api/memory/entries?limit=5` on mount — the same endpoint `MemoryManager`
uses with a smaller limit, same `MemoryRow` shape (`id`, `topic?`, `kind?`,
`scope?`, `content`, `summary?`, `isStatic?`, `updatedAt?`). Renders up to 5
rows, each showing `topic` (if present) and `content`/`summary` truncated to
~100 characters. A "View all memory →" link/button navigates to the `memory`
tab. Empty state: "Nothing remembered yet."

## Footer

A single feedback link: an `<a>` to
`https://github.com/arka6fx/yomi/issues/new` (Yomi's existing issue tracker
per `docs/agents/issue-tracker.md`), opened in a new tab. No invite-a-friend
or referral UI.

## Data flow summary

| Card | Endpoint | New fetch? | Existing consumer |
| --- | --- | --- | --- |
| History | `GET /api/conversation/shared` | Yes (home-scoped) | `ConversationManager` |
| Automations | `GET /api/schedules` | Yes (home-scoped) | `SchedulesManager` |
| Activity | (reused prop) | No | `page.tsx` `recentActivity` (billing tab) |
| Memory panel | `GET /api/memory/entries?limit=5` | Yes (home-scoped) | `MemoryManager` (with `limit=100`) |

No backend routes are created or modified. This is a frontend-only feature.

## Error handling

Each self-fetch follows the existing sibling-component pattern: `loading`
state while in flight, silent fallback to empty state on non-OK response or
thrown error (consistent with how `MemoryManager`/`ConversationManager` handle
fetch failures — no home-page-specific error banners, since a stat card
silently showing its empty state on a transient failure is an acceptable
degradation for a summary view).

## Testing

No automated test — consistent with every other UI-only feature shipped this
session (connections page, post-signup screen, settings menu). Manual browser
verification is attempted at the end of the implementation plan; the sandbox
in this environment has no reachable backend for every prior UI feature this
session, so a redirect-to-signin blocker is expected and will be reported
rather than worked around.
