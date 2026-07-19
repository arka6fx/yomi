# Docs Page Redesign (Nia-Style Shell) — Design

Date: 2026-07-20
Status: Approved (design); pending implementation plan

## Summary

Restyle `apps/landing/src/app/docs/page.tsx` — currently a single hand-rolled
page with a flat anchor-link sidebar — to adopt the visual shell of Nia's docs
(docs.trynia.ai): a dedicated full-width header, a grouped/filterable left
sidebar, and a right-hand scroll-spy "on this page" outline. Content stays a
single scrolling page (not split into multiple routes); only the chrome around
it changes. No new docs framework, no MDX, no backend — pure Next.js/Tailwind,
matching the footprint-ladder principle of extending existing code.

## Scope (v1)

- **In scope:** dedicated docs header, grouped sidebar, right on-page TOC,
  client-side search filter over the sidebar, scroll-spy highlighting, mobile
  collapse.
- **Out of scope:** multi-page routing (`/docs/connectors` etc.), MDX/content
  pipeline, real backend search/AI assistant, hero video, tab row
  (Guides/Integrations/API Reference/SDKs — none of these exist for Yomi
  today).

Explicitly dropped from Nia's reference design (per user decision): the tab
row, the hero video embed, and the "Ask Assistant" button — none are backed by
anything real in Yomi and would be misleading as inert UI.

## Architecture

`docs/page.tsx` remains a server component (keeps `metadata`/SEO/canonical
untouched). It renders existing content (`Section`, `Feature`, connector/plan
data — unchanged) as children of a new client shell:

```
apps/landing/src/components/docs/
  DocsHeader.tsx   — dedicated top bar (client, session-aware)
  DocsShell.tsx    — 3-column layout + scroll-spy + search state (client)
  DocsSidebar.tsx  — grouped, filterable left nav
  DocsToc.tsx      — right-hand scroll-spy outline
  docs-search.ts   — pure matchesQuery() + the static search index
```

`docs-search.ts` is plain data + a pure function so it can be unit-tested
without rendering anything:

```ts
export interface DocsEntry {
  id: string          // anchor id, matches Section id in page.tsx
  title: string
  group: "Getting Started" | "Capabilities" | "Account"
  summary: string      // one line, used for search matching only
}

export const DOCS_INDEX: DocsEntry[] = [ /* 10 entries, see Content grouping */ ]

export function matchesQuery(entry: DocsEntry, query: string): boolean
```

## Layout

**Header** (`DocsHeader`, replaces the shared floating `Nav` on this route
only): `BrandMark` (left) — search input with a `Ctrl K` hint that focuses it
on keypress (center) — `Support` link + session-aware CTA, reusing
`Nav.tsx`'s existing `authClient.useSession()` pattern to show `Dashboard` vs
`Get started` (right). No tabs, no video, no Ask Assistant.

**Body**, 3-column grid below the header (mirrors today's
`grid-cols-[200px_1fr]`, extended to 3 columns):

- **Left — `DocsSidebar`** (sticky, ~240px): the current flat 10-item `NAV`
  array becomes 3 grouped headers:
  - **Getting Started** — Overview, Getting started, Web app, Telegram bot
  - **Capabilities** — App connectors, Memory & knowledge, Voice & vision,
    Approvals & safety
  - **Account** — Plans & credits, Privacy

  This is the primary, filterable nav — typing in the header search dims/hides
  non-matching entries here (matched against `DOCS_INDEX` title + summary).
  The currently-scrolled section is highlighted (background + text color),
  driven by `DocsShell`'s scroll-spy state.

- **Center — existing content**: today's `Section`/`Feature` components,
  unchanged in content and copy, just reflowed into the narrower center
  column.

- **Right — `DocsToc`** (sticky, ~200px, `hidden xl:block`): a slim outline of
  the same 10 anchors, scroll-spy highlighted. Lighter-weight than the left
  sidebar (no grouping, no search) — it's a "where am I" indicator, the same
  role Nia's right TOC plays for a single guide page. Content overlaps with
  the left sidebar by design (single-page site, no finer sub-headings to
  differentiate them); this mirrors the current page's existing anchor list
  faithfully while adding the second rail Nia's layout is known for.

## Scroll-spy + search behavior

- `DocsShell` mounts an `IntersectionObserver` over the 10 `Section` DOM nodes
  (each already has `id`; add a shared `data-docs-section` marker query
  target). The section with the greatest intersection ratio near the
  viewport's top band becomes `activeId` state, passed down to both
  `DocsSidebar` and `DocsToc` for highlighting.
- Search: `DocsHeader` owns the query string (lifted to `DocsShell` via
  context or prop-drilling — this tree is shallow, no need for a state
  library). `DocsSidebar` filters `DOCS_INDEX` through `matchesQuery`;
  non-matches are dimmed (not removed, to avoid layout jump) unless the query
  is non-empty, in which case non-matches are hidden entirely and matches are
  reordered to the top of their group.
- `Ctrl/Cmd+K` focuses the search input from anywhere on the page (global
  `keydown` listener in `DocsHeader`, cleaned up on unmount).
- Clicking a sidebar/TOC entry or pressing Enter in search (first match)
  scrolls via native anchor jump (`href="#id"`); add `scroll-behavior: smooth`
  scoped to this page (or globally in `globals.css` if not already present —
  confirm at implementation time) so the jump isn't an instant snap.

## Mobile

- Below `lg`: `DocsSidebar` collapses into a hamburger-triggered slide-down
  drawer, reusing `Nav.tsx`'s existing `AnimatePresence`/`motion.div` slide
  pattern rather than inventing a new one.
- `DocsToc` is `hidden` below `xl` (already effectively hidden — the current
  page only shows its single sidebar `hidden lg:block`, so the right rail
  disappearing earlier is consistent with existing responsive behavior).
- Header's search input collapses to an icon-only trigger below `sm`,
  expanding to a full-width overlay input on tap (same interaction Nia's own
  mobile header likely uses, kept simple since the header owns no other
  clickable-when-collapsed real estate).

## Styling

No new tokens. Reuses existing `globals.css` HSL variables
(`--background`, `--card`, `--border`, `--primary`, `--muted-foreground`),
Inter/Instrument Serif fonts, `lucide-react` icons, `@yomi/ui-connectors`
`ConnectorIcon`, and the `cn()`/`class-variance-authority` conventions already
used in `components/ui/*`. `DocsHeader` is a plain sticky full-bleed bar
(border-bottom, `bg-card/80 backdrop-blur-xl` like the existing `Nav`'s
surface treatment) rather than `Nav`'s floating rounded pill — that
distinction is what visually signals "docs is its own surface," matching
Nia's flush top bar.

## Edge cases

- No JS (or before hydration): sidebar/TOC render as plain anchor lists (SSR
  markup unaffected by scroll-spy/search, which are progressive client-side
  enhancements) — the page must remain fully navigable via anchors alone.
- Search with zero matches: sidebar groups show an inline "No results" line
  rather than collapsing to nothing.
- Logged-in vs logged-out CTA: identical session check to `Nav.tsx`, so
  behavior is consistent site-wide.

## Testing

- **Unit:** `matchesQuery()` — case-insensitive substring match against title
  and summary, empty query matches everything, no match returns false.
- **Manual (no backend involved, so no route/integration tests apply):** run
  `bun run dev` for `apps/landing`, check `/docs` — search filters the
  sidebar live, scroll-spy highlights the correct section as you scroll,
  sidebar/TOC links jump correctly, `Ctrl/Cmd+K` focuses search, CTA reflects
  signed-in vs signed-out, responsive collapse at mobile width (sidebar drawer
  opens/closes, TOC hidden, search collapses to icon).
- `bun run typecheck` and `bun run lint` clean before considering this done
  (project convention).

## Future (explicitly deferred)

Multi-page routing per topic, MDX content pipeline, real indexed
search/backend, an actual "Ask Assistant" once/if a docs-grounded chat exists,
a hero walkthrough video once one is recorded. Nothing in v1 blocks these —
`DOCS_INDEX` entries map 1:1 to what would become individual routes if this
ever splits into a multi-page site.
