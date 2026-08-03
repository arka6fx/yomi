# Landing dashboard — memory viewer enhancements (item 7, sub-item 1/2) — design

Status: approved Date: 2026-08-03 Backlog ref: `docs/agentic-backlog.md` item 7

## Problem

`docs/agentic-backlog.md` item 7 ("Landing: memory viewer + usage/cost
insights") spans two independent subsystems: a memory-management UI and a
usage/cost dashboard. This spec covers only the first, smaller half — the
usage/cost half is deferred to a separate sub-spec since it needs new backend
work and shares no code with this one.

`apps/landing/src/components/dashboard/MemoryManager.tsx` (264 lines, rendered
as the "memory" tab in `apps/landing/src/app/dashboard/page.tsx`'s tab-switcher)
already covers list (`GET /api/memory/entries`), search
(`POST /api/memory/search`), add (`POST /api/memory/add`), and forget
(`DELETE /api/memory/:id`). The backend (`apps/backend/src/routes/memory.ts`)
exposes four capabilities this component never calls: `PATCH /:id` (edit),
`GET /superseded` (undo/history), `POST /graph-walk` (relations graph), and
finer list control (the current fetch is a flat `limit=100`, no
kind/scope/isStatic filtering). This is a real trust gap: users can add and
delete memories but can't fix a wrong one, see what Yomi used to remember, or
narrow a long list down.

## Goal

Add edit, history (undo-adjacent, read-only), and client-side filtering to the
memory tab — entirely a frontend build against the already-complete backend API,
no backend changes.

## Non-goals

- The relations graph (`POST /graph-walk`). A graph/tree visualization is a
  meaningfully bigger UI surface for a capability with less obvious day-to-day
  value than edit/history/filter; revisit later if there's a concrete need.
- A working "restore" action for superseded memories. The history view is
  read-only (see what a memory used to say and what replaced it). Restoring a
  specific old version cleanly — especially one that's been through several
  supersessions, or where the replacement merged in other memories too — is its
  own design problem; punting keeps this sub-item's scope tight.
- Server-side filtering. The backend's `GET /entries` only accepts `?limit=`
  today; adding `?kind=`/`?scope=`/`?isStatic=` query params would be backend
  work in what's meant to be a pure-frontend sub-item. Client-side filtering
  over a `limit=200` fetch (the backend's max) is sufficient — most users won't
  have anywhere near 200 memories.
- Any new component-rendering test infrastructure (React Testing Library /
  jsdom). The landing app has none today; see Testing below.
- The usage/cost dashboard (item 7's other half) — separate sub-spec.

## Architecture

`MemoryManager.tsx` stays the container: it owns the fetch calls and top-level
state (the memories list, filter values, and an active-vs-history view toggle)
and lays out its children. Three new files under the same
`apps/landing/src/components/dashboard/` directory:

- **`MemoryFilterBar.tsx`** — kind/scope/pinned-only filter controls, purely
  presentational (controlled by props from the container), operating on the
  already-fetched list client-side.
- **`MemoryRow.tsx`** — renders one memory. Default: the existing read-only row
  layout (topic/kind/scope badges, summary/content, forget button). Clicking an
  edit icon flips it into an inline form (topic/content/kind/ scope — the same
  fields the existing "Add memory" form already uses) with Save/Cancel. Save
  calls the container's `onSave` callback; the row itself holds no fetch logic.
- **`MemoryHistoryView.tsx`** — rendered instead of the active list when the
  history toggle is on, replacing (not supplementing) `MemoryFilterBar` — the
  filters apply only to the active list; history is a separate, simpler view
  with no filter controls of its own. Fetches `GET /superseded?limit=200` once
  per toggle-on, renders each entry read-only with a "replaced by" reference
  resolved from the response's `replacedBy` field. `replacedBy` can be `null`
  (the type is `MemoryEntry | null`) for a superseded row whose replacement was
  itself later forgotten/hard-deleted, rather than merged into another memory —
  in that case the row renders as "no longer active" instead of naming a
  successor. No restore action either way.

No new backend routes. Every new fetch reuses the existing pattern already
established by `MemoryManager.tsx`: a relative path
(`fetch("/api/memory/...", { headers: { Authorization: `Bearer ${token}` } })`),
manual `useState` for loading/error/data — no shared API client exists in this
codebase to adopt instead.

## Data flow

On mount, `MemoryManager` fetches `GET /api/memory/entries?limit=200` (bumped up
from the current `100`, since filtering is now client-side and a user's full
active set should be available to filter over). The existing search box still
hits `POST /search` server-side when non-empty; the new kind/scope/pinned
filters then apply client-side on top of whichever list — search results or the
full fetch — is currently loaded, via a pure predicate function
`matchesMemoryFilter(memory, filters)`.

**Edit → new id, not an in-place field update.** Confirmed directly against
`apps/backend/src/routes/memory.ts`: `PATCH /:id` looks up the existing row,
then calls the same `upsertMemory()` helper `POST /add` uses — which always
`INSERT`s a brand-new row (new `id`, `version: parent.version + 1`,
`parentMemoryId` pointing at the old row) and marks the old row
`status: "superseded"`. So `PATCH /:id`'s response (`{ memory: MemoryEntry }`)
has a **different id** than the URL parameter that was PATCHed. After a
successful save, the container must replace the edited row's entire entry (by
matching the _old_ id in the current list and splicing in the new memory object,
new id included) — not just merge changed fields into the existing object at the
same key.

Toggling "View history" on triggers `MemoryHistoryView`'s own
`GET /superseded?limit=200` fetch, once, cached in that component's state for
the rest of the session (no refetch on toggling back and forth). Toggling back
to "active" just re-renders `MemoryManager`'s already-held active list.

## Error handling

- **Edit failure:** inline error shown under the row being edited; the row stays
  in edit mode with the user's typed changes intact (no data loss on a failed
  save).
- **History fetch failure:** inline error in place of the list, with a retry
  button that re-triggers the fetch.
- Add/search/forget error handling is unchanged from what exists today.

## Testing

The landing app has no component-rendering test setup (no React Testing Library,
no jsdom/happy-dom — confirmed via `apps/landing/package.json` and the existing
test files, which are pure-logic `bun:test` unit tests, e.g.
`docs-search.test.ts`). No dashboard component has tests today either.
Consistent with that precedent: `matchesMemoryFilter` (the client-side filter
predicate) is extracted as a plain, exported function with real `bun:test` unit
tests covering each filter dimension (kind, scope, isStatic) and their
combination. The React component wiring itself (fetch calls, edit-in-place
interaction, JSX) is not covered by automated tests, matching how
`MemoryManager.tsx`'s existing list/search/add/forget logic is untested today.

## Open questions / deliberately deferred

- Whether 200 is the right fetch cap long-term for very active users —
  conservative starting point, matches the backend's own hard max.
- No pagination/infinite-scroll beyond the single 200-item fetch — deferred
  until a real user hits the cap.
