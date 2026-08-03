# Landing Memory Viewer Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edit, read-only history, and client-side filtering to the landing dashboard's memory tab, entirely as a frontend build against the already-complete backend memory API.

**Architecture:** `MemoryManager.tsx` stays the container (fetch calls, top-level state, layout). Three new presentational components — `MemoryRow` (view/edit-in-place), `MemoryFilterBar` (kind/scope/pinned filters), `MemoryHistoryView` (read-only superseded list) — plus a shared types file and a pure, unit-tested filter-predicate module. No new backend routes.

**Tech Stack:** Next.js (App Router, client components only), React, TypeScript, Tailwind CSS, `lucide-react` icons, `bun:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-landing-memory-viewer-design.md` — this plan implements it exactly; do not deviate without re-checking that file.
- **No new backend routes.** Every fetch calls an endpoint that already exists in `apps/backend/src/routes/memory.ts` (`GET /entries`, `GET /superseded`, `PATCH /:id`) exactly as it exists today.
- **No Next.js Route Handlers.** The landing app deploys as a Cloudflare Worker that proxies all `/api/*` requests directly to the backend before Next.js routing ever runs (`apps/landing/src/worker.ts`) — a new file under `apps/landing/src/app/api/` would silently be dead code in production. All new fetches are plain client-side `fetch()` calls from `"use client"` components.
- **Fetch pattern:** relative path + `Authorization: Bearer ${token}` header + manual `useState` for loading/error/data, matching the existing pattern in `MemoryManager.tsx` exactly. No shared API client exists in this codebase to adopt instead.
- **No relative-import file extensions.** This codebase's TypeScript/bundler resolution does not use `.js` extensions on relative imports (confirmed via `DashboardHome.tsx`, `DocsShell.tsx`) — `import { X } from "./memory-types"`, not `"./memory-types.js"`.
- **Edit → new id.** `PATCH /:id`'s response has a **different `id`** than the URL parameter (the backend always inserts a new versioned row and marks the old one superseded). After a successful save, replace the edited row's entire object in the list (matched by the *old* id), not just its fields.
- **History view replaces the filter bar**, it doesn't coexist with it — filters apply only to the active list.
- **`replacedBy` can be `null`** in a `GET /superseded` row — render "no longer active" instead of naming a successor in that case.
- **No component-rendering tests.** This codebase has no React Testing Library/jsdom setup and no dashboard component has tests today. Only the pure filter-predicate function gets `bun:test` unit tests (matching the existing `docs-search.test.ts` precedent).
- Visual conventions to match exactly (verbatim from the existing `MemoryManager.tsx`): card `rounded-2xl border border-border bg-card p-5 sm:p-6`, primary button `rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50`, inline error `text-xs text-destructive`, empty state `rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center`, section/loading spinner `Loader2` with `className="animate-spin"`.
- Test command, run from repo root: `bun test --isolate apps/landing/src/components/dashboard/memory-filters.test.ts` (Task 1).
- Typecheck command, run from repo root: `bun run typecheck`.

---

## File Structure

- Create: `apps/landing/src/components/dashboard/memory-types.ts` — shared `MemoryRow` type, `KINDS`/`SCOPES` constants (moved out of `MemoryManager.tsx` so the new components can import them without a circular dependency).
- Create: `apps/landing/src/components/dashboard/memory-filters.ts` — `MemoryFilters` type, `matchesMemoryFilter()` pure function.
- Create: `apps/landing/src/components/dashboard/memory-filters.test.ts` — unit tests for the filter predicate.
- Create: `apps/landing/src/components/dashboard/MemoryRow.tsx` — one memory: view mode (existing layout) + inline edit mode.
- Create: `apps/landing/src/components/dashboard/MemoryFilterBar.tsx` — kind/scope/pinned-only filter controls.
- Create: `apps/landing/src/components/dashboard/MemoryHistoryView.tsx` — read-only superseded-memories list with its own fetch.
- Modify: `apps/landing/src/components/dashboard/MemoryManager.tsx` — container: adds filter state, history-toggle state, edit-save handler (with the new-id splice), bumps the entries fetch to `limit=200`, renders `MemoryFilterBar`/`MemoryRow`/`MemoryHistoryView` in place of the current inline list JSX.

---

### Task 1: Shared types + filter predicate

**Files:**
- Create: `apps/landing/src/components/dashboard/memory-types.ts`
- Create: `apps/landing/src/components/dashboard/memory-filters.ts`
- Create: `apps/landing/src/components/dashboard/memory-filters.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // memory-types.ts
  export type MemoryRow = {
    id: string
    topic?: string | null
    kind?: string | null
    scope?: string | null
    content: string
    summary?: string | null
    isStatic?: boolean
    updatedAt?: string | null
  }
  export const KINDS: readonly ["fact", "preference", "project", "decision", "open_thread"]
  export const SCOPES: readonly ["global", "project", "app", "session"]

  // memory-filters.ts
  export type MemoryFilters = { kind: string | null; scope: string | null; pinnedOnly: boolean }
  export function matchesMemoryFilter(memory: MemoryRow, filters: MemoryFilters): boolean
  ```
  Tasks 2-5 consume `MemoryRow`/`KINDS`/`SCOPES` from `./memory-types` and `MemoryFilters`/`matchesMemoryFilter` from `./memory-filters` by these exact names.

- [ ] **Step 1: Write the failing tests**

Create `apps/landing/src/components/dashboard/memory-filters.test.ts` with this content:

```ts
import { describe, expect, it } from "bun:test"
import { matchesMemoryFilter, type MemoryFilters } from "./memory-filters"
import type { MemoryRow } from "./memory-types"

const noFilter: MemoryFilters = { kind: null, scope: null, pinnedOnly: false }

function makeMemory(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: "m1",
    topic: "Test topic",
    kind: "fact",
    scope: "global",
    content: "Test content",
    summary: null,
    isStatic: false,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("matchesMemoryFilter", () => {
  it("matches everything when no filters are set", () => {
    expect(matchesMemoryFilter(makeMemory(), noFilter)).toBe(true)
  })

  it("matches when kind filter equals the memory's kind", () => {
    const memory = makeMemory({ kind: "preference" })
    expect(matchesMemoryFilter(memory, { ...noFilter, kind: "preference" })).toBe(true)
  })

  it("excludes when kind filter does not equal the memory's kind", () => {
    const memory = makeMemory({ kind: "fact" })
    expect(matchesMemoryFilter(memory, { ...noFilter, kind: "preference" })).toBe(false)
  })

  it("matches when scope filter equals the memory's scope", () => {
    const memory = makeMemory({ scope: "project" })
    expect(matchesMemoryFilter(memory, { ...noFilter, scope: "project" })).toBe(true)
  })

  it("excludes when scope filter does not equal the memory's scope", () => {
    const memory = makeMemory({ scope: "global" })
    expect(matchesMemoryFilter(memory, { ...noFilter, scope: "project" })).toBe(false)
  })

  it("excludes a non-pinned memory when pinnedOnly is true", () => {
    const memory = makeMemory({ isStatic: false })
    expect(matchesMemoryFilter(memory, { ...noFilter, pinnedOnly: true })).toBe(false)
  })

  it("includes a pinned memory when pinnedOnly is true", () => {
    const memory = makeMemory({ isStatic: true })
    expect(matchesMemoryFilter(memory, { ...noFilter, pinnedOnly: true })).toBe(true)
  })

  it("requires every active filter to match (combination)", () => {
    const memory = makeMemory({ kind: "fact", scope: "global", isStatic: true })
    expect(
      matchesMemoryFilter(memory, { kind: "fact", scope: "global", pinnedOnly: true }),
    ).toBe(true)
    expect(
      matchesMemoryFilter(memory, { kind: "fact", scope: "project", pinnedOnly: true }),
    ).toBe(false)
  })

  it("treats a memory with no kind as not matching a specific kind filter", () => {
    const memory = makeMemory({ kind: null })
    expect(matchesMemoryFilter(memory, { ...noFilter, kind: "fact" })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --isolate apps/landing/src/components/dashboard/memory-filters.test.ts`
Expected: FAIL — `memory-filters.ts` / `memory-types.ts` do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/landing/src/components/dashboard/memory-types.ts` with this content:

```ts
export type MemoryRow = {
  id: string
  topic?: string | null
  kind?: string | null
  scope?: string | null
  content: string
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string | null
}

export const KINDS = ["fact", "preference", "project", "decision", "open_thread"] as const
export const SCOPES = ["global", "project", "app", "session"] as const
```

Create `apps/landing/src/components/dashboard/memory-filters.ts` with this content:

```ts
import type { MemoryRow } from "./memory-types"

export type MemoryFilters = {
  kind: string | null
  scope: string | null
  pinnedOnly: boolean
}

export function matchesMemoryFilter(memory: MemoryRow, filters: MemoryFilters): boolean {
  if (filters.kind && memory.kind !== filters.kind) return false
  if (filters.scope && memory.scope !== filters.scope) return false
  if (filters.pinnedOnly && !memory.isStatic) return false
  return true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate apps/landing/src/components/dashboard/memory-filters.test.ts`
Expected: PASS — 9 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/landing/src/components/dashboard/memory-types.ts apps/landing/src/components/dashboard/memory-filters.ts apps/landing/src/components/dashboard/memory-filters.test.ts
git commit -m "feat(landing): add memory filter predicate and shared types"
```

---

### Task 2: `MemoryRow` — view + inline edit

**Files:**
- Create: `apps/landing/src/components/dashboard/MemoryRow.tsx`

**Interfaces:**
- Consumes: `MemoryRow`, `KINDS`, `SCOPES` from `./memory-types` (Task 1).
- Produces:
  ```tsx
  export function MemoryRow(props: {
    memory: MemoryRow
    forgetting: boolean
    onForget: (id: string) => void
    onSave: (id: string, patch: { topic: string; content: string; kind: string; scope: string }) => Promise<boolean>
  }): JSX.Element
  ```
  `onSave` returns `Promise<boolean>` — `true` on success (the row exits edit mode), `false` on failure (the row stays in edit mode with an inline error, and the caller is expected to have already set whatever error state it wants `MemoryRow` to display via re-render — see Step 3's `saveError` local state for how the row itself surfaces a message independent of the parent). Task 5 consumes `MemoryRow` (the component) and calls it with these exact prop names.

This is a pure presentational component — it holds its own transient edit-form state (draft topic/content/kind/scope, saving flag, save error) but does **not** call `fetch` itself; `onSave` is provided by the container (Task 5), matching the "row itself holds no fetch logic" requirement from the spec's Architecture section.

- [ ] **Step 1: Write the component**

Create `apps/landing/src/components/dashboard/MemoryRow.tsx` with this content:

```tsx
"use client"

import { useState } from "react"
import { Loader2, Pencil, Pin, Trash2, X, Check } from "lucide-react"
import { KINDS, SCOPES, type MemoryRow as MemoryRowData } from "./memory-types"

export function MemoryRow({
  memory,
  forgetting,
  onForget,
  onSave,
}: {
  memory: MemoryRowData
  forgetting: boolean
  onForget: (id: string) => void
  onSave: (
    id: string,
    patch: { topic: string; content: string; kind: string; scope: string },
  ) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draftTopic, setDraftTopic] = useState(memory.topic ?? "")
  const [draftContent, setDraftContent] = useState(memory.content)
  const [draftKind, setDraftKind] = useState<(typeof KINDS)[number]>(
    (memory.kind as (typeof KINDS)[number]) || "fact",
  )
  const [draftScope, setDraftScope] = useState<(typeof SCOPES)[number]>(
    (memory.scope as (typeof SCOPES)[number]) || "global",
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  function startEdit() {
    setDraftTopic(memory.topic ?? "")
    setDraftContent(memory.content)
    setDraftKind((memory.kind as (typeof KINDS)[number]) || "fact")
    setDraftScope((memory.scope as (typeof SCOPES)[number]) || "global")
    setSaveError("")
    setEditing(true)
  }

  async function handleSave() {
    if (!draftContent.trim() || saving) return
    setSaving(true)
    setSaveError("")
    const ok = await onSave(memory.id, {
      topic: draftTopic.trim(),
      content: draftContent.trim(),
      kind: draftKind,
      scope: draftScope,
    })
    setSaving(false)
    if (ok) {
      setEditing(false)
    } else {
      setSaveError("Couldn't save that change")
    }
  }

  if (editing) {
    return (
      <li className="rounded-xl border border-border bg-background/40 px-4 py-3">
        <input
          value={draftTopic}
          onChange={(e) => setDraftTopic(e.target.value)}
          placeholder="Topic (optional)"
          className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
        />
        <textarea
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={draftKind}
            onChange={(e) => setDraftKind(e.target.value as (typeof KINDS)[number])}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={draftScope}
            onChange={(e) => setDraftScope(e.target.value as (typeof SCOPES)[number])}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={!draftContent.trim() || saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <X size={12} />
            Cancel
          </button>
        </div>
        {saveError && <p className="mt-2 text-xs text-destructive">{saveError}</p>}
      </li>
    )
  }

  return (
    <li className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-4 py-3 transition-colors hover:border-border/80">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {memory.isStatic && <Pin size={11} className="shrink-0 text-primary" />}
          <span className="truncate text-sm font-medium text-foreground">
            {memory.topic || memory.kind || "Memory"}
          </span>
          {memory.kind && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
              {memory.kind.replace("_", " ")}
            </span>
          )}
          {memory.scope && memory.scope !== "global" && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {memory.scope}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {memory.summary || memory.content}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-all group-hover:opacity-100">
        <button
          onClick={startEdit}
          aria-label="Edit memory"
          className="rounded-lg p-1.5 text-muted-foreground/60 transition-all hover:bg-primary/10 hover:text-primary"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onForget(memory.id)}
          disabled={forgetting}
          aria-label="Forget memory"
          className="rounded-lg p-1.5 text-muted-foreground/60 transition-all hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {forgetting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
    </li>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (No automated test for this component per the plan's no-component-testing constraint — verify by reading the diff against the spec's Architecture section: view mode preserved from the original inline JSX, edit mode added, no fetch calls inside the component.)

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/components/dashboard/MemoryRow.tsx
git commit -m "feat(landing): add MemoryRow view/edit-in-place component"
```

---

### Task 3: `MemoryFilterBar`

**Files:**
- Create: `apps/landing/src/components/dashboard/MemoryFilterBar.tsx`

**Interfaces:**
- Consumes: `KINDS`, `SCOPES` from `./memory-types` (Task 1); `MemoryFilters` from `./memory-filters` (Task 1).
- Produces:
  ```tsx
  export function MemoryFilterBar(props: {
    filters: MemoryFilters
    onChange: (filters: MemoryFilters) => void
  }): JSX.Element
  ```
  Task 5 consumes `MemoryFilterBar` and renders it with these exact prop names, holding the `MemoryFilters` state itself.

Purely presentational and controlled — all state lives in the parent (Task 5); this component only renders controls and calls `onChange` with the next filters value.

- [ ] **Step 1: Write the component**

Create `apps/landing/src/components/dashboard/MemoryFilterBar.tsx` with this content:

```tsx
"use client"

import { Pin } from "lucide-react"
import { KINDS, SCOPES } from "./memory-types"
import type { MemoryFilters } from "./memory-filters"

export function MemoryFilterBar({
  filters,
  onChange,
}: {
  filters: MemoryFilters
  onChange: (filters: MemoryFilters) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select
        value={filters.kind ?? ""}
        onChange={(e) => onChange({ ...filters, kind: e.target.value || null })}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
      >
        <option value="">All kinds</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k.replace("_", " ")}
          </option>
        ))}
      </select>
      <select
        value={filters.scope ?? ""}
        onChange={(e) => onChange({ ...filters, scope: e.target.value || null })}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
      >
        <option value="">All scopes</option>
        {SCOPES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        onClick={() => onChange({ ...filters, pinnedOnly: !filters.pinnedOnly })}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          filters.pinnedOnly
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border text-foreground hover:bg-muted"
        }`}
      >
        <Pin size={12} />
        Pinned only
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/components/dashboard/MemoryFilterBar.tsx
git commit -m "feat(landing): add MemoryFilterBar component"
```

---

### Task 4: `MemoryHistoryView`

**Files:**
- Create: `apps/landing/src/components/dashboard/MemoryHistoryView.tsx`

**Interfaces:**
- Consumes: `MemoryRow` type from `./memory-types` (Task 1). Fetches `GET /api/memory/superseded?limit=200` directly (this component owns its own fetch, unlike `MemoryRow`/`MemoryFilterBar` — matching the spec's Architecture section, which describes `MemoryHistoryView` as fetching independently once per toggle-on).
- Produces:
  ```tsx
  export function MemoryHistoryView(props: { token: string }): JSX.Element
  ```
  Task 5 consumes `MemoryHistoryView` and renders it (passing `token`) in place of the active list when the history toggle is on.

- [ ] **Step 1: Write the component**

Create `apps/landing/src/components/dashboard/MemoryHistoryView.tsx` with this content:

```tsx
"use client"

import { useEffect, useState } from "react"
import { Loader2, RotateCcw } from "lucide-react"
import type { MemoryRow } from "./memory-types"

type SupersededRow = MemoryRow & { replacedBy: MemoryRow | null }

export function MemoryHistoryView({ token }: { token: string }) {
  const [rows, setRows] = useState<SupersededRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/memory/superseded?limit=200", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Couldn't load history (${res.status})`)
      const data = (await res.json()) as { memories?: SupersededRow[] }
      setRows(data.memories ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load history")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Loading history…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
        <p className="text-xs text-destructive">{error}</p>
        <button
          onClick={() => void load()}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          Retry
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No history yet</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          Memories that get updated or replaced will show up here.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-start gap-3 rounded-xl border border-border bg-background/40 px-4 py-3"
        >
          <RotateCcw size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {row.topic || row.kind || "Memory"}
              </span>
              {row.kind && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                  {row.kind.replace("_", " ")}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-through decoration-muted-foreground/40">
              {row.summary || row.content}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.replacedBy
                ? `Replaced by: ${row.replacedBy.topic || row.replacedBy.summary || row.replacedBy.content}`
                : "No longer active"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/components/dashboard/MemoryHistoryView.tsx
git commit -m "feat(landing): add MemoryHistoryView component"
```

---

### Task 5: Wire everything into `MemoryManager.tsx`

**Files:**
- Modify: `apps/landing/src/components/dashboard/MemoryManager.tsx` (full current content shown below — this task rewrites the file)

**Interfaces:**
- Consumes: `MemoryRow` type, `KINDS`, `SCOPES` from `./memory-types` (Task 1); `MemoryFilters`, `matchesMemoryFilter` from `./memory-filters` (Task 1); `MemoryRow` component from `./MemoryRow` (Task 2); `MemoryFilterBar` from `./MemoryFilterBar` (Task 3); `MemoryHistoryView` from `./MemoryHistoryView` (Task 4).
- Produces: `MemoryManager` component's external interface (`{ token: string }` prop) is unchanged — `dashboard/page.tsx` requires no modification.

**Important wiring detail:** the spec requires `MemoryHistoryView` to fetch once per toggle-on and not refetch when the user toggles back and forth. A plain `{showHistory ? <MemoryHistoryView/> : <activeView/>}` ternary would **unmount** `MemoryHistoryView` every time the user switches back to "Active," discarding its internal `rows` state — the next toggle-on would remount it and refetch, violating the spec. The JSX below instead lazily mounts `MemoryHistoryView` the *first* time history is toggled on (via a `historyMounted` flag that, once `true`, never goes back to `false`) and thereafter only toggles its visibility with a `hidden` CSS class — so it fetches exactly once, stays mounted, and toggling is instant with no data loss.

The current full content of `apps/landing/src/components/dashboard/MemoryManager.tsx` (264 lines) is:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { Brain, Loader2, Pin, Plus, Search, Trash2, X } from "lucide-react"

type MemoryRow = {
  id: string
  topic?: string | null
  kind?: string | null
  scope?: string | null
  content: string
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string | null
}

const KINDS = ["fact", "preference", "project", "decision", "open_thread"] as const
const SCOPES = ["global", "project", "app", "session"] as const

// Cloud memory management. Talks to the backend /api/memory/* endpoints (the same
// canonical store the Telegram agent reads), so edits here apply everywhere.
export function MemoryManager({ token }: { token: string }) {
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [forgetting, setForgetting] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState("")
  const [draftTopic, setDraftTopic] = useState("")
  const [draftKind, setDraftKind] = useState<(typeof KINDS)[number]>("fact")
  const [draftScope, setDraftScope] = useState<(typeof SCOPES)[number]>("global")
  const [saving, setSaving] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(
    async (q: string) => {
      setLoading(true)
      setError("")
      try {
        const res = q.trim()
          ? await fetch("/api/memory/search", {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/json" },
              body: JSON.stringify({ query: q.trim(), limit: 50 }),
            })
          : await fetch("/api/memory/entries?limit=100", { headers: auth })
        if (!res.ok) throw new Error(`Couldn't load memories (${res.status})`)
        const data = (await res.json()) as { memories?: MemoryRow[] }
        setMemories(data.memories ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load memories")
      } finally {
        setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(query), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query, load])

  async function handleAdd() {
    if (!draft.trim() || saving) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/memory/add", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft.trim(),
          topic: draftTopic.trim() || undefined,
          kind: draftKind,
          scope: draftScope,
        }),
      })
      if (!res.ok) throw new Error("Couldn't save that memory")
      setDraft("")
      setDraftTopic("")
      setShowAdd(false)
      await load(query)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that memory")
    } finally {
      setSaving(false)
    }
  }

  async function handleForget(id: string) {
    setForgetting(id)
    setError("")
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: auth,
      })
      if (!res.ok) throw new Error("Couldn't forget that memory")
      setMemories((prev) => prev.filter((m) => m.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't forget that memory")
    } finally {
      setForgetting(null)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Brain size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-2xl leading-tight text-foreground">
              What Yomi <span className="italic">remembers</span>
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Durable facts Yomi keeps across your web app and Telegram. Add, search, or forget them
              here.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {showAdd ? <X size={12} /> : <Plus size={12} />}
          {showAdd ? "Cancel" : "Add memory"}
        </button>
      </div>

      {showAdd && (
        <div className="mb-5 rounded-xl border border-border bg-background/40 p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Something Yomi should remember about you or your work…"
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={draftTopic}
              onChange={(e) => setDraftTopic(e.target.value)}
              placeholder="Topic (optional)"
              className="flex-1 min-w-[140px] rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as (typeof KINDS)[number])}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              value={draftScope}
              onChange={(e) => setDraftScope(e.target.value as (typeof SCOPES)[number])}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!draft.trim() || saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Save
            </button>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories"
          className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
        />
      </div>

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading memories…
        </div>
      ) : memories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            {query ? "No memories match that search" : "No memories yet"}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            {query
              ? "Try a different term, or clear the search."
              : "Yomi adds memories as you work, or you can add one above."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => (
            <li
              key={m.id}
              className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-4 py-3 transition-colors hover:border-border/80"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {m.isStatic && <Pin size={11} className="shrink-0 text-primary" />}
                  <span className="truncate text-sm font-medium text-foreground">
                    {m.topic || m.kind || "Memory"}
                  </span>
                  {m.kind && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                      {m.kind.replace("_", " ")}
                    </span>
                  )}
                  {m.scope && m.scope !== "global" && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {m.scope}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {m.summary || m.content}
                </p>
              </div>
              <button
                onClick={() => handleForget(m.id)}
                disabled={forgetting === m.id}
                aria-label="Forget memory"
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground/60 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
              >
                {forgetting === m.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 1: Replace the file with the wired-up version**

Replace the full content of `apps/landing/src/components/dashboard/MemoryManager.tsx` with:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { Brain, History, Loader2, Plus, Search, X } from "lucide-react"
import { KINDS, SCOPES, type MemoryRow as MemoryRowData } from "./memory-types"
import { matchesMemoryFilter, type MemoryFilters } from "./memory-filters"
import { MemoryRow } from "./MemoryRow"
import { MemoryFilterBar } from "./MemoryFilterBar"
import { MemoryHistoryView } from "./MemoryHistoryView"

const NO_FILTERS: MemoryFilters = { kind: null, scope: null, pinnedOnly: false }

// Cloud memory management. Talks to the backend /api/memory/* endpoints (the same
// canonical store the Telegram agent reads), so edits here apply everywhere.
export function MemoryManager({ token }: { token: string }) {
  const [memories, setMemories] = useState<MemoryRowData[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [forgetting, setForgetting] = useState<string | null>(null)
  const [filters, setFilters] = useState<MemoryFilters>(NO_FILTERS)
  const [showHistory, setShowHistory] = useState(false)
  // Once true, stays true — MemoryHistoryView mounts lazily on first toggle-on and is
  // never unmounted again, so its internal fetch runs exactly once per page load
  // (see the Task 5 wiring note above for why a plain ternary would refetch every toggle).
  const [historyMounted, setHistoryMounted] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState("")
  const [draftTopic, setDraftTopic] = useState("")
  const [draftKind, setDraftKind] = useState<(typeof KINDS)[number]>("fact")
  const [draftScope, setDraftScope] = useState<(typeof SCOPES)[number]>("global")
  const [saving, setSaving] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(
    async (q: string) => {
      setLoading(true)
      setError("")
      try {
        const res = q.trim()
          ? await fetch("/api/memory/search", {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/json" },
              body: JSON.stringify({ query: q.trim(), limit: 50 }),
            })
          : await fetch("/api/memory/entries?limit=200", { headers: auth })
        if (!res.ok) throw new Error(`Couldn't load memories (${res.status})`)
        const data = (await res.json()) as { memories?: MemoryRowData[] }
        setMemories(data.memories ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load memories")
      } finally {
        setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(query), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query, load])

  async function handleAdd() {
    if (!draft.trim() || saving) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/memory/add", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft.trim(),
          topic: draftTopic.trim() || undefined,
          kind: draftKind,
          scope: draftScope,
        }),
      })
      if (!res.ok) throw new Error("Couldn't save that memory")
      setDraft("")
      setDraftTopic("")
      setShowAdd(false)
      await load(query)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that memory")
    } finally {
      setSaving(false)
    }
  }

  async function handleForget(id: string) {
    setForgetting(id)
    setError("")
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: auth,
      })
      if (!res.ok) throw new Error("Couldn't forget that memory")
      setMemories((prev) => prev.filter((m) => m.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't forget that memory")
    } finally {
      setForgetting(null)
    }
  }

  // PATCH /:id always inserts a new versioned row (new id) and marks the old one
  // superseded — so a successful save must splice in the whole returned memory
  // object at the OLD id's position, not merge fields into the existing object.
  async function handleSave(
    id: string,
    patch: { topic: string; content: string; kind: string; scope: string },
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return false
      const data = (await res.json()) as { memory?: MemoryRowData }
      if (!data.memory) return false
      const updated = data.memory
      setMemories((prev) => prev.map((m) => (m.id === id ? updated : m)))
      return true
    } catch {
      return false
    }
  }

  const visibleMemories = memories.filter((m) => matchesMemoryFilter(m, filters))

  function toggleHistory() {
    setShowHistory((v) => {
      const next = !v
      if (next) setHistoryMounted(true)
      return next
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Brain size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-2xl leading-tight text-foreground">
              What Yomi <span className="italic">remembers</span>
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Durable facts Yomi keeps across your web app and Telegram. Add, search, edit, or
              forget them here.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={toggleHistory}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
              showHistory
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-foreground hover:bg-muted"
            }`}
          >
            <History size={12} />
            {showHistory ? "Active" : "History"}
          </button>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {showAdd ? <X size={12} /> : <Plus size={12} />}
            {showAdd ? "Cancel" : "Add memory"}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-5 rounded-xl border border-border bg-background/40 p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Something Yomi should remember about you or your work…"
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={draftTopic}
              onChange={(e) => setDraftTopic(e.target.value)}
              placeholder="Topic (optional)"
              className="flex-1 min-w-[140px] rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as (typeof KINDS)[number])}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              value={draftScope}
              onChange={(e) => setDraftScope(e.target.value as (typeof SCOPES)[number])}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!draft.trim() || saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Save
            </button>
          </div>
        </div>
      )}

      {historyMounted && (
        <div className={showHistory ? "" : "hidden"}>
          <MemoryHistoryView token={token} />
        </div>
      )}

      <div className={showHistory ? "hidden" : ""}>
        <div className="relative mb-4">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories"
            className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
        </div>

        <MemoryFilterBar filters={filters} onChange={setFilters} />

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading memories…
          </div>
        ) : visibleMemories.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              {query || filters.kind || filters.scope || filters.pinnedOnly
                ? "No memories match that search or filter"
                : "No memories yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              {query || filters.kind || filters.scope || filters.pinnedOnly
                ? "Try a different term, or clear the search/filters."
                : "Yomi adds memories as you work, or you can add one above."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleMemories.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                forgetting={forgetting === m.id}
                onForget={handleForget}
                onSave={handleSave}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run the filter-predicate tests once more to confirm nothing broke**

Run: `bun test --isolate apps/landing/src/components/dashboard/memory-filters.test.ts`
Expected: PASS — 9 tests, 0 fail (unchanged from Task 1, since this task doesn't touch `memory-filters.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/landing/src/components/dashboard/MemoryManager.tsx
git commit -m "feat(landing): wire edit/history/filters into the memory tab"
```

---

## Final Verification

- [ ] Run `bun run format` proactively before pushing (every prior PR this session has needed this at least once), then re-verify tests still pass.
- [ ] Run `bun run lint`.
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate apps/landing/src/components/dashboard/memory-filters.test.ts` from repo root — 9/9 pass.
- [ ] Re-read `docs/superpowers/specs/2026-08-03-landing-memory-viewer-design.md` and confirm every section (architecture, data flow, error handling, testing) has a corresponding implemented piece.
- [ ] Manually verify in a browser if possible (`bun run dev` in `apps/landing`, sign in, open the dashboard's memory tab): add a memory, edit it (confirm it doesn't disappear/duplicate — the new-id splice is the trickiest part of this plan), toggle history, toggle filters, forget a memory. This is a UI-heavy feature with no component-rendering tests, so a manual smoke pass is the only way to catch a wiring mistake before merge.
