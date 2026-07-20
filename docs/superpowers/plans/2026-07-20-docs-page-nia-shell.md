# Docs Page Nia-Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `apps/landing/src/app/docs/page.tsx` with a Nia-style shell — dedicated header, grouped/filterable sidebar, right "on this page" outline, scroll-spy — while keeping the page's content and single-scroll structure unchanged.

**Architecture:** A new `apps/landing/src/components/docs/` module holds a pure search-index/matcher (`docs-search.ts`), two presentational rail components (`DocsSidebar`, `DocsToc`), an interactive header (`DocsHeader`), and a composing client shell (`DocsShell`) that owns scroll-spy + search + mobile-menu state. `docs/page.tsx` stays a server component; it now renders its existing hero and `Section` content as `DocsShell`'s `banner` and `children` props instead of wrapping them in the old flat sidebar/grid.

**Tech Stack:** Next.js App Router (React 19, server + client components), Tailwind (existing HSL token system in `globals.css`), `lucide-react` icons, `better-auth` client (`authClient.useSession()`), Bun test runner.

## Global Constraints

- No new dependencies, no MDX/docs framework, no backend/search-index service — pure Next.js/Tailwind (spec: "Architecture").
- Single scrolling page — no new routes under `/docs/*` (spec: "Scope (v1)").
- No tab row, no hero video, no "Ask Assistant" button (spec: "Scope (v1)").
- Reuse existing design tokens only: `--background`, `--card`, `--border`, `--primary`, `--muted-foreground` etc. from `apps/landing/src/app/globals.css` — no new CSS variables (spec: "Styling").
- Reuse `Nav.tsx`'s exact session-check pattern (`authClient.useSession()`) for the header CTA (spec: "Layout — Header").
- `apps/landing/CLAUDE.md` Cloudflare Workers I/O rules apply to this app — not directly relevant here since this task touches no request/DB code, but do not add any module-level mutable state.
- `bun run typecheck` and `bun run lint` must pass clean before any task is considered done (project convention, `AGENTS.md`).
- Commit messages: Conventional Commits, lowercase, no full stop, max 72 chars (`AGENTS.md`).

---

### Task 1: Search index + matcher (`docs-search.ts`)

**Files:**
- Create: `apps/landing/src/components/docs/docs-search.ts`
- Test: `apps/landing/src/components/docs/docs-search.test.ts`
- Modify: `apps/landing/package.json` (add a `test` script — this app has none yet)

**Interfaces:**
- Produces: `export type DocsGroup = "Getting Started" | "Capabilities" | "Account"`, `export interface DocsEntry { id: string; title: string; group: DocsGroup; summary: string }`, `export const DOCS_INDEX: DocsEntry[]` (10 entries, `id`s match the existing `Section` ids in `docs/page.tsx`: `overview`, `getting-started`, `web`, `telegram`, `connectors`, `memory`, `voice-vision`, `approvals`, `plans`, `privacy`), `export function matchesQuery(entry: DocsEntry, query: string): boolean`.

- [ ] **Step 1: Add a test script to `apps/landing/package.json`**

Open `apps/landing/package.json` and find the `"scripts"` block (starts around line 4, alongside `"dev"`, `"build"`). Add a `test` entry matching the convention used in `packages/agent-core/package.json`:

```json
    "test": "bun test --pass-with-no-tests",
```

- [ ] **Step 2: Write the failing test**

Create `apps/landing/src/components/docs/docs-search.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { DOCS_INDEX, matchesQuery } from "./docs-search"

describe("matchesQuery", () => {
  it("matches everything when the query is empty", () => {
    for (const entry of DOCS_INDEX) {
      expect(matchesQuery(entry, "")).toBe(true)
    }
  })

  it("matches a case-insensitive substring of the title", () => {
    const entry = DOCS_INDEX.find((e) => e.id === "connectors")!
    expect(matchesQuery(entry, "CONNECTOR")).toBe(true)
  })

  it("matches a case-insensitive substring of the summary", () => {
    const entry = DOCS_INDEX.find((e) => e.id === "plans")!
    expect(matchesQuery(entry, "credit balances")).toBe(true)
  })

  it("returns false when nothing matches", () => {
    const entry = DOCS_INDEX.find((e) => e.id === "privacy")!
    expect(matchesQuery(entry, "xyzzy-no-match")).toBe(false)
  })

  it("ignores leading/trailing whitespace in the query", () => {
    const entry = DOCS_INDEX.find((e) => e.id === "overview")!
    expect(matchesQuery(entry, "  overview  ")).toBe(true)
  })
})
```

- [ ] **Step 2b: Run the test to verify it fails**

Run: `cd apps/landing && bun test src/components/docs/docs-search.test.ts`
Expected: FAIL — `docs-search` module not found.

- [ ] **Step 3: Implement `docs-search.ts`**

Create `apps/landing/src/components/docs/docs-search.ts`:

```ts
export type DocsGroup = "Getting Started" | "Capabilities" | "Account"

export interface DocsEntry {
  id: string
  title: string
  group: DocsGroup
  summary: string
}

// Ids match the `Section` ids in ../../app/docs/page.tsx exactly — this is the
// single source of truth for the sidebar, the "on this page" outline, and search.
export const DOCS_INDEX: DocsEntry[] = [
  {
    id: "overview",
    title: "Overview",
    group: "Getting Started",
    summary: "What Yomi is and how the web app and Telegram bot share memory.",
  },
  {
    id: "getting-started",
    title: "Getting started",
    group: "Getting Started",
    summary: "Sign up, connect your apps, and start chatting.",
  },
  {
    id: "web",
    title: "Web app",
    group: "Getting Started",
    summary: "Image analysis, voice and text, visible actions, two routing paths.",
  },
  {
    id: "telegram",
    title: "Telegram bot",
    group: "Getting Started",
    summary: "Chat commands, voice notes, and image analysis on Telegram.",
  },
  {
    id: "connectors",
    title: "App connectors",
    group: "Capabilities",
    summary: "Gmail, Calendar, Drive, Docs, Sheets, Slides, GitHub, Notion, Slack, Linear.",
  },
  {
    id: "memory",
    title: "Memory & knowledge",
    group: "Capabilities",
    summary: "Long-term memory and your synced documents (RAG).",
  },
  {
    id: "voice-vision",
    title: "Voice & vision",
    group: "Capabilities",
    summary: "Speak and listen, and send a screenshot or photo for analysis.",
  },
  {
    id: "approvals",
    title: "Approvals & safety",
    group: "Capabilities",
    summary: "Actions that send or change things pause for your approval first.",
  },
  {
    id: "plans",
    title: "Plans & credits",
    group: "Account",
    summary: "Explore, Pro, and Max plans and how credit balances work.",
  },
  {
    id: "privacy",
    title: "Privacy",
    group: "Account",
    summary: "What happens to connected-app data and how to disconnect.",
  },
]

export function matchesQuery(entry: DocsEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return entry.title.toLowerCase().includes(q) || entry.summary.toLowerCase().includes(q)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/landing && bun test src/components/docs/docs-search.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/landing/package.json apps/landing/src/components/docs/docs-search.ts apps/landing/src/components/docs/docs-search.test.ts
git commit -m "feat: add docs search index and matcher"
```

---

### Task 2: Nav rail components (`DocsSidebar`, `DocsToc`)

**Files:**
- Create: `apps/landing/src/components/docs/DocsSidebar.tsx`
- Create: `apps/landing/src/components/docs/DocsToc.tsx`

**Interfaces:**
- Consumes: `DOCS_INDEX: DocsEntry[]`, `matchesQuery(entry, query)`, `DocsGroup` from `./docs-search` (Task 1). `cn()` from `@/lib/utils`.
- Produces: `export function DocsSidebar({ activeId, query, onNavigate }: { activeId: string | null; query: string; onNavigate?: () => void }): JSX.Element`. `export function DocsToc({ activeId }: { activeId: string | null }): JSX.Element`.

These are presentational — no test file (project has no component-testing setup; per the spec's Testing section, UI behavior here is covered by the manual pass in Task 6). Verified via typecheck now and manual check later.

- [ ] **Step 1: Create `DocsSidebar.tsx`**

```tsx
"use client"

import { cn } from "@/lib/utils"
import { DOCS_INDEX, matchesQuery, type DocsGroup } from "./docs-search"

const GROUPS: DocsGroup[] = ["Getting Started", "Capabilities", "Account"]

export function DocsSidebar({
  activeId,
  query,
  onNavigate,
}: {
  activeId: string | null
  query: string
  onNavigate?: () => void
}) {
  const matches = DOCS_INDEX.filter((entry) => matchesQuery(entry, query))

  if (matches.length === 0) {
    return (
      <p className="px-3 py-1.5 text-sm text-muted-foreground">
        No results for &ldquo;{query}&rdquo;
      </p>
    )
  }

  return (
    <nav className="space-y-5">
      {GROUPS.map((group) => {
        const entries = matches.filter((entry) => entry.group === group)
        if (entries.length === 0) return null

        return (
          <div key={group}>
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
              {group}
            </p>
            <div className="mt-1.5 space-y-0.5">
              {entries.map((entry) => (
                <a
                  key={entry.id}
                  href={`#${entry.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                    activeId === entry.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {entry.title}
                </a>
              ))}
            </div>
          </div>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Create `DocsToc.tsx`**

```tsx
"use client"

import { cn } from "@/lib/utils"
import { DOCS_INDEX } from "./docs-search"

export function DocsToc({ activeId }: { activeId: string | null }) {
  return (
    <nav aria-label="On this page" className="space-y-3">
      <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
        On this page
      </p>
      <div className="space-y-0.5">
        {DOCS_INDEX.map((entry) => (
          <a
            key={entry.id}
            href={`#${entry.id}`}
            className={cn(
              "block rounded-lg px-3 py-1 text-[13px] transition-colors",
              activeId === entry.id
                ? "font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.title}
          </a>
        ))}
      </div>
    </nav>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/landing && bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/landing/src/components/docs/DocsSidebar.tsx apps/landing/src/components/docs/DocsToc.tsx
git commit -m "feat: add docs sidebar and on-this-page nav rails"
```

---

### Task 3: Docs header (`DocsHeader`)

**Files:**
- Create: `apps/landing/src/components/docs/DocsHeader.tsx`

**Interfaces:**
- Consumes: `BrandMark` from `@/components/BrandMark`, `authClient` from `@/lib/auth-client` (same import/usage pattern as `apps/landing/src/components/Nav.tsx:8,23`).
- Produces: `export function DocsHeader({ query, onQueryChange, menuOpen, onMenuToggle }: { query: string; onQueryChange: (value: string) => void; menuOpen: boolean; onMenuToggle: () => void }): JSX.Element`.

- [ ] **Step 1: Create `DocsHeader.tsx`**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Menu, Search, X } from "lucide-react"
import { BrandMark } from "@/components/BrandMark"
import { authClient } from "@/lib/auth-client"

export function DocsHeader({
  query,
  onQueryChange,
  menuOpen,
  onMenuToggle,
}: {
  query: string
  onQueryChange: (value: string) => void
  menuOpen: boolean
  onMenuToggle: () => void
}) {
  const { data: session } = authClient.useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setMobileSearchOpen(true)
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <BrandMark size="sm" />

        <div className="relative hidden max-w-md flex-1 sm:block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search docs..."
            className="w-full rounded-xl border border-border bg-muted/40 py-1.5 pl-9 pr-14 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Ctrl K
          </kbd>
        </div>

        <button
          type="button"
          onClick={() => setMobileSearchOpen((v) => !v)}
          aria-label="Search docs"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground sm:hidden"
        >
          {mobileSearchOpen ? <X size={18} /> : <Search size={18} />}
        </button>

        <div className="ml-auto hidden items-center gap-4 sm:flex">
          <Link
            href="/support"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Support
          </Link>
          <Link
            href={session ? "/dashboard" : "/signup"}
            className="rounded-xl bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {session ? "Dashboard" : "Get started"}
          </Link>
        </div>

        <button
          type="button"
          onClick={onMenuToggle}
          aria-label="Toggle docs navigation"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground lg:hidden"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {mobileSearchOpen && (
        <div className="border-t border-border px-4 py-3 sm:hidden">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search docs..."
              autoFocus
              className="w-full rounded-xl border border-border bg-muted/40 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>
      )}
    </header>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/landing && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/components/docs/DocsHeader.tsx
git commit -m "feat: add dedicated docs header with search and session cta"
```

---

### Task 4: Composing shell (`DocsShell`)

**Files:**
- Create: `apps/landing/src/components/docs/DocsShell.tsx`

**Interfaces:**
- Consumes: `DOCS_INDEX` from `./docs-search` (Task 1), `DocsHeader` (Task 3), `DocsSidebar`, `DocsToc` (Task 2), `AnimatePresence`/`motion` from `framer-motion` (already a dependency — used by `Nav.tsx`, no new package).
- Produces: `export function DocsShell({ banner, children }: { banner?: React.ReactNode; children: React.ReactNode }): JSX.Element` — this is what `docs/page.tsx` (Task 5) renders.

- [ ] **Step 1: Create `DocsShell.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { DOCS_INDEX } from "./docs-search"
import { DocsHeader } from "./DocsHeader"
import { DocsSidebar } from "./DocsSidebar"
import { DocsToc } from "./DocsToc"

export function DocsShell({
  banner,
  children,
}: {
  banner?: React.ReactNode
  children: React.ReactNode
}) {
  const [activeId, setActiveId] = useState<string>(DOCS_INDEX[0]!.id)
  const [query, setQuery] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)

  // Scroll-spy: track which Section is nearest the top of the viewport so both
  // rails can highlight it. Ids come from DOCS_INDEX, which must match the
  // `Section` ids rendered in docs/page.tsx.
  useEffect(() => {
    const sections = DOCS_INDEX.map((entry) => document.getElementById(entry.id)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible.length > 0) {
          setActiveId(visible[0]!.target.id)
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    )

    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [])

  return (
    <div>
      <DocsHeader
        query={query}
        onQueryChange={setQuery}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((v) => !v)}
      />

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-b border-border bg-card/95 px-6 py-4 lg:hidden"
          >
            <DocsSidebar activeId={activeId} query={query} onNavigate={() => setMenuOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {banner}

      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 lg:grid-cols-[220px_1fr] xl:grid-cols-[220px_1fr_200px]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <DocsSidebar activeId={activeId} query={query} />
          </div>
        </aside>

        <main className="min-w-0">{children}</main>

        <aside className="hidden xl:block">
          <div className="sticky top-24">
            <DocsToc activeId={activeId} />
          </div>
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/landing && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/components/docs/DocsShell.tsx
git commit -m "feat: add docs shell composing header, rails, and scroll-spy"
```

---

### Task 5: Wire the shell into `docs/page.tsx`

**Files:**
- Modify: `apps/landing/src/app/docs/page.tsx`

**Interfaces:**
- Consumes: `DocsShell` from `@/components/docs/DocsShell` (Task 4).

This task removes the old flat sidebar/grid and the shared `Nav`, keeping every `Section`/`Feature`/data array and all copy byte-for-byte identical. Three edits, in order:

- [ ] **Step 1: Swap the `Nav` import for `DocsShell`**

In `apps/landing/src/app/docs/page.tsx`, find:

```tsx
import { ConnectorIcon } from "@yomi/ui-connectors"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
```

Replace with:

```tsx
import { ConnectorIcon } from "@yomi/ui-connectors"
import Footer from "@/components/Footer"
import { DocsShell } from "@/components/docs/DocsShell"
```

- [ ] **Step 2: Delete the now-unused flat `NAV` array**

Find and delete this whole block (it was only consumed by the old sidebar `<aside>`, which Task 5 Step 3 removes — `DOCS_INDEX` in `docs-search.ts` is the replacement):

```tsx
const NAV = [
  { id: "overview", label: "Overview" },
  { id: "getting-started", label: "Getting started" },
  { id: "web", label: "Web app" },
  { id: "telegram", label: "Telegram bot" },
  { id: "connectors", label: "App connectors" },
  { id: "memory", label: "Memory & knowledge" },
  { id: "voice-vision", label: "Voice & vision" },
  { id: "approvals", label: "Approvals & safety" },
  { id: "plans", label: "Plans & credits" },
  { id: "privacy", label: "Privacy" },
]
```

- [ ] **Step 3: Replace the top-level return wrapper (opening half)**

Find:

```tsx
  return (
    <div className="site-texture-bg min-h-dvh text-foreground">
      <Nav />

      {/* Header */}
      <header className="relative overflow-hidden border-b border-border">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 120% at 50% -10%, hsl(var(--primary) / 0.18), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-5xl px-6 py-16 text-center sm:py-20">
          <Eyebrow>
            <Sparkles size={11} />
            Documentation
          </Eyebrow>
          <h1 className="mt-5 font-serif text-4xl tracking-tight sm:text-5xl">
            Everything Yomi does, <span className="font-serif italic text-primary">today</span>.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            A complete, honest map of what&apos;s shipped: the Telegram bot,
            every app connector, memory, voice, and how plans and credits work.
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 lg:grid-cols-[200px_1fr]">
        {/* Sidebar */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1">
            {NAV.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0">
          <Section id="overview" eyebrow="Overview" title="What Yomi is">
```

Replace with:

```tsx
  return (
    <div className="site-texture-bg min-h-dvh text-foreground">
      <DocsShell
        banner={
          <header className="relative overflow-hidden border-b border-border">
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(70% 120% at 50% -10%, hsl(var(--primary) / 0.18), transparent 60%)",
              }}
            />
            <div className="relative mx-auto max-w-5xl px-6 py-16 text-center sm:py-20">
              <Eyebrow>
                <Sparkles size={11} />
                Documentation
              </Eyebrow>
              <h1 className="mt-5 font-serif text-4xl tracking-tight sm:text-5xl">
                Everything Yomi does, <span className="font-serif italic text-primary">today</span>.
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                A complete, honest map of what&apos;s shipped: the Telegram bot,
                every app connector, memory, voice, and how plans and credits work.
              </p>
            </div>
          </header>
        }
      >
        <Section id="overview" eyebrow="Overview" title="What Yomi is">
```

Note: everything between `<Section id="overview" ...>` and the closing wrapper below (all `Section`/`Feature` blocks, unchanged) stays exactly as-is — only the enclosing wrapper changes.

- [ ] **Step 4: Replace the top-level return wrapper (closing half)**

Find:

```tsx
          <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/60 p-6">
            <Send size={18} className="text-primary" />
            <p className="text-sm text-muted-foreground">
              Ready to try it?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Create your account
              </Link>{" "}
              or{" "}
               <Link href="/dashboard" className="font-medium text-primary hover:underline">
                open the dashboard
              </Link>
              .
            </p>
          </div>
        </main>
      </div>

      <Footer />
    </div>
  )
}
```

Replace with:

```tsx
          <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/60 p-6">
            <Send size={18} className="text-primary" />
            <p className="text-sm text-muted-foreground">
              Ready to try it?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Create your account
              </Link>{" "}
              or{" "}
               <Link href="/dashboard" className="font-medium text-primary hover:underline">
                open the dashboard
              </Link>
              .
            </p>
          </div>
      </DocsShell>

      <Footer />
    </div>
  )
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors. (An unused-import lint error here means Step 1 or 2 was incomplete — double check `Nav` and `NAV` are both fully gone.)

- [ ] **Step 6: Commit**

```bash
git add apps/landing/src/app/docs/page.tsx
git commit -m "refactor: wire docs page through the nia-style shell"
```

---

### Task 6: Manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite for this change**

Run: `cd apps/landing && bun test`
Expected: the 5 `docs-search` tests pass (plus `--pass-with-no-tests` covers any other empty suites).

- [ ] **Step 2: Run typecheck and lint across the whole repo**

Run: `bun run typecheck && bun run lint` (from repo root)
Expected: all packages pass; only pre-existing warnings (if any) remain, no new errors.

- [ ] **Step 3: Start the dev server**

Run: `cd apps/landing && bun run dev`
Then open `http://localhost:3000/docs` in a browser.

- [ ] **Step 4: Manually verify against the spec's Testing section**

Check each of the following (all from `docs/superpowers/specs/2026-07-20-docs-page-nia-shell-design.md`):

1. Typing in the header search filters the left sidebar live; clearing it restores the full grouped list.
2. Scrolling the page highlights the correct entry in both the left sidebar and the right "on this page" outline as each section passes the top of the viewport. If the highlight fires noticeably too early/late, adjust the `rootMargin` value in `DocsShell.tsx`'s `IntersectionObserver` (currently `-96px 0px -60% 0px`).
3. Clicking a sidebar or "on this page" link jumps to the right section with a smooth scroll (not an instant snap — confirms `scroll-behavior: smooth` from `globals.css:53` is in effect).
4. `Ctrl+K` (or `Cmd+K` on Mac) focuses the search input from anywhere on the page.
5. CTA button in the header reads "Get started" when signed out and "Dashboard" when signed in — check both states (sign in via `/signin`, then revisit `/docs`).
6. At a mobile viewport width (< 1024px): the hamburger button opens a slide-down drawer containing the grouped sidebar; the right "on this page" column is not present (hidden below `xl`); the search icon expands to a full-width input on tap.
7. All existing content (Overview through Privacy, including the connector grid, plan cards, and Telegram command table) still renders with unchanged copy.

- [ ] **Step 5: Fix any issues found, then re-run Steps 1–2**

If Step 4 surfaces a bug, fix it in the relevant component file from Tasks 1–5, re-run the unit/typecheck/lint commands, and re-verify in the browser before proceeding.

- [ ] **Step 6: Final commit (only if Step 5 required changes)**

```bash
git add -A
git commit -m "fix: address manual verification findings on docs shell"
```

If Step 4 passed with no changes needed, skip this commit — Task 5's commit is the last one.
