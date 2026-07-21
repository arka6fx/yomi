# Dashboard Connections Page Redesign — Design

Date: 2026-07-21
Status: Approved (design); pending implementation plan

## Summary

Redesign the dashboard's connections list (`apps/landing/src/app/dashboard/page.tsx`'s
"integrations" tab, rendered via `@yomi/ui-connectors`' `ConnectorMarketplace`)
from a card grid to a denser row-list layout, and add a "next step" callout
above it that recommends one specific unconnected connector from a fixed
priority list. Loosely inspired by a competitor's connections screen
(structure only — layout pattern, never their name/copy/logo), adapted to
Yomi's existing 61-connector catalog and 12-category taxonomy.

This is the first of five remaining UI-redesign sub-projects from the
original request (connections page, post-signup screen, custom MCP
connector form, settings menu, dashboard home page — docs site is a sixth,
separate item). Picked first because the integration-nudge feature
(`docs/superpowers/specs/2026-07-21-agent-integration-nudge-design.md`)
already deep-links into this page via `?connect=<id>`, so this redesign is
where those links now land.

## Scope (v1)

- **In scope:** row-list layout for `ConnectorTile`/`ConnectorMarketplace`
  (category grouping logic unchanged), a new `NextStepCard` component with a
  hardcoded priority list, refined `DARK_THEME`/`LIGHT_THEME` token values.
- **Out of scope:** the other four UI-redesign sub-projects (each gets its
  own spec later), unifying the Tailwind (page shell) vs. inline-style
  theme-token (`ui-connectors`) split — a separate infrastructure change,
  not something this redesign needs to solve, changing which 12 categories
  exist or remapping connectors into a coarser taxonomy (explicitly
  rejected during brainstorming — see below).

## Rejected approaches

- **Coarser top-level grouping** (e.g. 4-6 new buckets like the reference
  screenshot's chats/apps/social/custom) instead of the existing 12
  categories. Rejected: would mean hand-classifying all 61 connectors into
  a second taxonomy and keeping both in sync as new connectors get added,
  for a purely cosmetic win the existing categories already deliver well
  enough once presented as a denser list.
- **Card grid, kept as-is** (just polished). Rejected after a mockup
  comparison: with 61 connectors, the row list is significantly more
  scannable and uses far less vertical space; the user picked it directly
  over the card option.
- **Dynamic next-step source** (driven by recent Telegram nudges, or no
  default card at all — only the `?connect=` deep link). Rejected in favor
  of the fixed priority list: no new plumbing to persist "last suggested
  connector" for the dashboard to read, predictable behavior, and it still
  composes with the deep link rather than replacing it (see below).

## Design

### 1. Row layout (`packages/ui-connectors/src/components/ConnectorMarketplace.tsx`)

`ConnectorMarketplace`'s category-grouping loop (iterate categories present
in `connectors`, render a header with a "N connected" count, iterate that
category's connectors) is unchanged. Only what renders per connector
changes: `ConnectorTile` goes from a vertical card (icon+name row, then a
description paragraph, then a full-width action button) to a single
horizontal row — icon (smaller, ~30px vs. current 42px), name and
description inline on one line (description dimmed, truncated with
`text-overflow: ellipsis` rather than wrapping), and the connect/connected
status right-aligned, with a thin `border-bottom` divider between rows
instead of card borders. The existing `highlighted`/`highlightId` prop
plumbing (scroll-into-view + accent border/glow on the matching row) from
the nudge feature carries over unchanged — it was written against `info.id`
matching, not against the card DOM structure, so it doesn't care that the
container changed from a card to a row.

`ConnectorTileProps` and `ConnectorMarketplaceProps` keep their current
shape (`info`, `t`, `onConnect`, `onDisconnect`, `loading`, `limitReached`,
`highlighted`/`highlightId`) — this is a rendering change, not an interface
change.

### 2. `NextStepCard` (new, `packages/ui-connectors/src/components/NextStepCard.tsx`)

A pure priority-pick function, colocated in the same file since it's a
small, single-purpose component (unlike `integration-catalog.ts`, this
doesn't need to be consumed from the backend — it's UI-only):

```ts
export interface NextStepSuggestion {
  id: string
  name: string
  category: ConnectorCategory
  reason: string
}

// Ordered by what unlocks the most value first. Deliberately short — this
// is a "get the essentials connected" nudge, not a completion tracker, so
// it disappears once these are done even if dozens of niche connectors
// remain unconnected.
const NEXT_STEP_PRIORITY: NextStepSuggestion[] = [
  { id: "google-calendar", name: "Google Calendar", category: "productivity",
    reason: "Yomi can already read your email — add your calendar so it can schedule things too." },
  { id: "google-drive", name: "Google Drive", category: "productivity",
    reason: "Let Yomi search, create, and edit your files, not just email." },
  { id: "slack", name: "Slack", category: "communication",
    reason: "Read and send Slack messages from Telegram." },
  { id: "notion", name: "Notion", category: "knowledge",
    reason: "Search and update your Notion workspace." },
  { id: "github", name: "GitHub", category: "developer",
    reason: "Check PRs, issues, and repos without leaving the chat." },
  { id: "google-tasks", name: "Google Tasks", category: "productivity",
    reason: "Add and check off tasks by just asking." },
  { id: "linear", name: "Linear", category: "developer",
    reason: "Track and update Linear issues from Telegram." },
]

export function pickNextStep(connectedIds: string[]): NextStepSuggestion | null {
  const connected = new Set(connectedIds)
  return NEXT_STEP_PRIORITY.find((s) => !connected.has(s.id)) ?? null
}

export function NextStepCard({
  connectedIds,
  theme,
  appUrl,
}: {
  connectedIds: string[]
  theme: ConnectorTheme
  appUrl: string
}) {
  const suggestion = pickNextStep(connectedIds)
  if (!suggestion) return null
  // renders the callout, "Connect" button links to `${appUrl}/dashboard?connect=${suggestion.id}`
  // — same deep-link mechanism the Telegram nudge feature already uses.
}
```

Reusing `?connect=<id>` here (rather than inventing a second mechanism)
means clicking the card's Connect button does exactly what a Telegram nudge
link does: switches to the integrations tab, scrolls to that row, and
highlights it — even though in this case the user is already on the page.

### 3. Theme token refinement (`packages/ui-connectors/src/types.ts`)

Adjust `DARK_THEME`/`LIGHT_THEME` values only — tighter contrast between
`border` and `borderHi` (rows need a visible-but-quiet divider, not the
current card-border strength), slightly warmer `surface` tone. No new
tokens, no structural change to `ConnectorTheme`.

### 4. Wiring (`apps/landing/src/app/dashboard/page.tsx`)

One addition above the existing `<ConnectorMarketplace>` call, inside the
`activeTab === "integrations"` block:

```tsx
<NextStepCard connectedIds={connectedProviders} theme={DARK_THEME} appUrl={window.location.origin} />
```

`connectedProviders` is existing state. `page.tsx` is a `"use client"`
component with no existing `appUrl`-equivalent constant (checked: no
`NEXT_PUBLIC_APP_URL` usage anywhere in `apps/landing/src`), so
`window.location.origin` is used directly — it's the same origin the
dashboard is already being served from, works correctly across dev,
staging, and production with no env var needed. No other changes to
`page.tsx`.

## Testing

`pickNextStep` is a pure function — unit-testable the same way
`suggestIntegrationsFor` was: given a `connectedIds` array, asserts the
correct first-unconnected result, `null` when everything on the priority
list is connected, and that connectors not on the priority list never
affect the result. Lives in
`packages/ui-connectors/src/components/NextStepCard.test.ts`.

No automated test for the row-layout rendering or `NextStepCard`'s visual
output — this package has no React component test harness (confirmed when
building the `highlightId` prop earlier in this session). Verify with
typecheck + lint, then a manual check in a real browser.

**Known limitation carried over from the last implementation round:** this
sandbox's dev environment can't reach the backend/DB (`/api/auth/get-session`
500s), so an automated or headless-browser check can't get past the
dashboard's sign-in redirect. The manual verification step will need to
happen on a machine with a real signed-in session — flag this to the user
again at implementation time rather than silently skipping it.
