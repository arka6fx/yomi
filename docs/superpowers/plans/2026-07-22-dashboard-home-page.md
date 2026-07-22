# Dashboard Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard a landing "home" view — three stat cards (History, Automations, Activity) plus a memory preview panel and a feedback link — that becomes the new default tab, replacing "integrations".

**Architecture:** A new sibling component `DashboardHome.tsx` (same convention as `MemoryManager.tsx`/`ConversationManager.tsx`/`SchedulesManager.tsx`) self-fetches conversation history, schedules, and memory previews from existing endpoints, and receives the page's already-fetched `recentActivity` array as a prop. `page.tsx` wires it in as the new default `activeTab`, first in the tab bar.

**Tech Stack:** Next.js (App Router), React, Tailwind, lucide-react icons — `apps/landing`.

## Global Constraints

- Frontend-only — no backend routes are created or modified.
- No new fetches for the Activity card — it reuses `page.tsx`'s existing `recentActivity` (`UsageSummary.recentActivity`, already fetched unconditionally at page level).
- Weather, the Meetings card, and invite-a-friend/referrals are explicitly dropped — do not add them.
- No automated frontend test, consistent with every other UI feature shipped this session. Verification is typecheck/lint/build plus an attempted manual browser walkthrough.

---

### Task 1: `DashboardHome.tsx` component

**Files:**
- Create: `apps/landing/src/components/dashboard/DashboardHome.tsx`

**Interfaces:**
- Consumes: `DashboardTab` type from `apps/landing/src/components/dashboard/SettingsMenu.tsx` (already exports `type DashboardTab`).
- Produces: `export function DashboardHome({ token, recentActivity, onNavigate }: { token: string; recentActivity: ActivityItem[]; onNavigate: (tab: DashboardTab) => void })` and `export type ActivityItem = { id: string; label: string; category: string; credits: number; createdAt: string }` — Task 2 imports both and passes `session.session.token`, the page's `recentActivity` state, and `setActiveTab` as `onNavigate`.

Confirmed response shapes (read directly from the existing sibling components, not guessed):
- `GET /api/conversation/shared` → `{ history?: Array<{ role: "user" | "assistant" | "system"; content: string }> }` (`ConversationManager.tsx:25`).
- `GET /api/schedules` → `{ schedules?: ScheduleRow[] }` where `ScheduleRow` has `id, schedule, prompt, enabled, oneShot?, nextRunAt?, lastRunAt?, lastRunStatus?, lastRunError?, runCount?` (`SchedulesManager.tsx:6-17,53`).
- `GET /api/memory/entries?limit=5` → `{ memories?: MemoryRow[] }` where `MemoryRow` has `id, topic?, kind?, scope?, content, summary?, isStatic?, updatedAt?` (`MemoryManager.tsx:6-15,51`).

- [ ] **Step 1: Create the component file**

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Activity, Brain, Clock, ExternalLink, Loader2, MessageSquare } from "lucide-react"
import type { DashboardTab } from "./SettingsMenu"

type ConversationTurn = { role: "user" | "assistant" | "system"; content: string }

type ScheduleRow = {
  id: string
  schedule: string
  prompt: string
  enabled: boolean
  oneShot?: boolean
  nextRunAt?: string | null
  lastRunAt?: string | null
  lastRunStatus?: string | null
  lastRunError?: string | null
  runCount?: number
}

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

export type ActivityItem = {
  id: string
  label: string
  category: string
  credits: number
  createdAt: string
}

function truncate(text: string, max: number) {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max).trim()}…` : trimmed
}

function relativePast(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function relativeFuture(value: string) {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  if (minutes <= 0) return "any moment"
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

function StatCard({
  icon: Icon,
  title,
  loading,
  empty,
  emptyText,
  onClick,
  children,
}: {
  icon: typeof Clock
  title: string
  loading: boolean
  empty: boolean
  emptyText: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 sm:p-5 text-left transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={14} />
        <span className="text-xs font-medium uppercase tracking-widest">{title}</span>
      </div>
      {loading ? (
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
      ) : empty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="text-sm text-foreground">{children}</div>
      )}
    </button>
  )
}

// Dashboard landing view: at-a-glance summary cards over data other tabs already
// fetch in full, plus a memory preview. Reuses existing endpoints only — no new backend.
export function DashboardHome({
  token,
  recentActivity,
  onNavigate,
}: {
  token: string
  recentActivity: ActivityItem[]
  onNavigate: (tab: DashboardTab) => void
}) {
  const [history, setHistory] = useState<ConversationTurn[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(true)
  const [memory, setMemory] = useState<MemoryRow[]>([])
  const [memoryLoading, setMemoryLoading] = useState(true)

  const auth = { Authorization: `Bearer ${token}` }

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch("/api/conversation/shared", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { history?: ConversationTurn[] }
      setHistory((data.history ?? []).filter((t) => t.role !== "system"))
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [token])

  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true)
    try {
      const res = await fetch("/api/schedules", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { schedules?: ScheduleRow[] }
      setSchedules(data.schedules ?? [])
    } catch {
      setSchedules([])
    } finally {
      setSchedulesLoading(false)
    }
  }, [token])

  const loadMemory = useCallback(async () => {
    setMemoryLoading(true)
    try {
      const res = await fetch("/api/memory/entries?limit=5", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { memories?: MemoryRow[] }
      setMemory(data.memories ?? [])
    } catch {
      setMemory([])
    } finally {
      setMemoryLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadHistory()
    void loadSchedules()
    void loadMemory()
  }, [loadHistory, loadSchedules, loadMemory])

  const lastUserTurn = [...history].reverse().find((t) => t.role === "user")
  const enabledSchedules = schedules.filter((s) => s.enabled)
  const soonestNextRunAt = enabledSchedules
    .map((s) => s.nextRunAt)
    .filter((v): v is string => !!v)
    .sort()[0]
  const latestActivity = recentActivity[0]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          icon={MessageSquare}
          title="History"
          loading={historyLoading}
          empty={history.length === 0}
          emptyText="No conversation yet"
          onClick={() => onNavigate("conversation")}
        >
          {lastUserTurn && <p>{truncate(lastUserTurn.content, 80)}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {history.length} message{history.length === 1 ? "" : "s"}
          </p>
        </StatCard>

        <StatCard
          icon={Clock}
          title="Automations"
          loading={schedulesLoading}
          empty={schedules.length === 0}
          emptyText="No automations yet"
          onClick={() => onNavigate("schedules")}
        >
          <p>
            {enabledSchedules.length} of {schedules.length} active
          </p>
          {soonestNextRunAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Next run {relativeFuture(soonestNextRunAt)}
            </p>
          )}
        </StatCard>

        <StatCard
          icon={Activity}
          title="Activity"
          loading={false}
          empty={!latestActivity}
          emptyText="No activity yet"
          onClick={() => onNavigate("billing")}
        >
          {latestActivity && (
            <>
              <p>{latestActivity.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {relativePast(latestActivity.createdAt)}
              </p>
            </>
          )}
        </StatCard>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Brain size={16} className="text-primary" />
            </div>
            <h2 className="text-sm font-medium text-foreground">Memory</h2>
          </div>
          <button
            onClick={() => onNavigate("memory")}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </button>
        </div>

        {memoryLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : memory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing remembered yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {memory.map((row) => (
              <li key={row.id} className="text-sm">
                {row.topic && <span className="font-medium text-foreground">{row.topic}: </span>}
                <span className="text-muted-foreground">
                  {truncate(row.summary || row.content, 100)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-center">
        <a
          href="https://github.com/arka6fx/yomi/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink size={12} />
          Send feedback
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck the new file in isolation**

Run: `cd apps/landing && bun run typecheck`
Expected: passes with no errors mentioning `DashboardHome.tsx`. (It's not imported anywhere yet, so this only validates the file's own internal types — that's expected and sufficient for this step; full integration typechecking happens in Task 2.)

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/components/dashboard/DashboardHome.tsx
git commit -m "feat(landing): add DashboardHome summary component"
```

---

### Task 2: Wire `DashboardHome` in as the new default tab

**Files:**
- Modify: `apps/landing/src/components/dashboard/SettingsMenu.tsx` (`DashboardTab` union)
- Modify: `apps/landing/src/app/dashboard/page.tsx` (imports, default tab, tab-bar array, tab icon, new `activeTab === "home"` block)

**Interfaces:**
- Consumes: `DashboardHome` and `ActivityItem` from Task 1 (`apps/landing/src/components/dashboard/DashboardHome.tsx`).
- Produces: `DashboardTab` union now includes `"home"` as its first member — every other consumer of this type (`page.tsx`, `DashboardHome.tsx`) picks this up automatically since both import the type rather than redefining it.

- [ ] **Step 1: Add `"home"` to `DashboardTab`**

In `apps/landing/src/components/dashboard/SettingsMenu.tsx`, find:

```tsx
export type DashboardTab =
  | "integrations"
  | "memory"
  | "schedules"
  | "conversation"
  | "status"
  | "billing"
  | "profile"
  | "writing-style"
  | "privacy"
```

Change to:

```tsx
export type DashboardTab =
  | "home"
  | "integrations"
  | "memory"
  | "schedules"
  | "conversation"
  | "status"
  | "billing"
  | "profile"
  | "writing-style"
  | "privacy"
```

- [ ] **Step 2: Import `DashboardHome` and the `Home` icon in `page.tsx`**

In `apps/landing/src/app/dashboard/page.tsx`, find the lucide-react import block:

```tsx
import {
  LogOut,
  Check,
  Crown,
  Loader2,
  Shield,
  Sparkles,
  Cuboid,
  Trash2,
  AlertTriangle,
  WalletCards,
  ReceiptText,
  Plug,
  MessageSquare,
  Plus,
  ExternalLink,
  Zap,
  Brain,
  Clock,
  Activity,
} from "lucide-react"
```

Change to (adds `Home`):

```tsx
import {
  LogOut,
  Check,
  Crown,
  Loader2,
  Shield,
  Sparkles,
  Cuboid,
  Trash2,
  AlertTriangle,
  WalletCards,
  ReceiptText,
  Plug,
  MessageSquare,
  Plus,
  ExternalLink,
  Zap,
  Brain,
  Clock,
  Activity,
  Home,
} from "lucide-react"
```

Find:

```tsx
import { SettingsMenu, type DashboardTab } from "@/components/dashboard/SettingsMenu"
```

Change to (adds the new component import directly below it):

```tsx
import { SettingsMenu, type DashboardTab } from "@/components/dashboard/SettingsMenu"
import { DashboardHome } from "@/components/dashboard/DashboardHome"
```

- [ ] **Step 3: Make `"home"` the default tab**

Find:

```tsx
  const [activeTab, setActiveTab] = useState<DashboardTab>("integrations")
```

Change to:

```tsx
  const [activeTab, setActiveTab] = useState<DashboardTab>("home")
```

- [ ] **Step 4: Add `"home"` as the first tab in the tab bar**

Find:

```tsx
            {(
              ["integrations", "memory", "schedules", "conversation", "status"] as const
            ).map((tab) => (
```

Change to:

```tsx
            {(
              ["home", "integrations", "memory", "schedules", "conversation", "status"] as const
            ).map((tab) => (
```

- [ ] **Step 5: Add the home tab icon**

Find:

```tsx
                {tab === "integrations" && <Plug size={13} />}
                {tab === "memory" && <Brain size={13} />}
                {tab === "schedules" && <Clock size={13} />}
                {tab === "conversation" && <MessageSquare size={13} />}
                {tab === "status" && <Activity size={13} />}
```

Change to:

```tsx
                {tab === "home" && <Home size={13} />}
                {tab === "integrations" && <Plug size={13} />}
                {tab === "memory" && <Brain size={13} />}
                {tab === "schedules" && <Clock size={13} />}
                {tab === "conversation" && <MessageSquare size={13} />}
                {tab === "status" && <Activity size={13} />}
```

- [ ] **Step 6: Insert the new `home` tab content block**

Find:

```tsx
        {activeTab === "integrations" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
```

Change to (inserts a new block immediately before it):

```tsx
        {activeTab === "home" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <DashboardHome
              token={session.session.token}
              recentActivity={recentActivity}
              onNavigate={setActiveTab}
            />
          </motion.div>
        )}

        {activeTab === "integrations" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
```

- [ ] **Step 7: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: both pass with no errors. `session.session.token` and `recentActivity` are both already-defined values in `DashboardContent` (confirmed at `page.tsx:693` and used identically at `page.tsx:879,890,901` for the sibling manager components) — no additional wiring is needed.

- [ ] **Step 8: Commit**

```bash
git add apps/landing/src/components/dashboard/SettingsMenu.tsx apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(landing): make dashboard home the default tab"
```

---

### Task 3: Whole-monorepo verification and manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Run full monorepo typecheck, lint, and test**

Run (from repo root): `bun run typecheck && bun run lint && bun run test`
Expected: all pass. This is a frontend-only change with no backend code touched, so no backend test file needs updating — this step confirms nothing elsewhere in the monorepo broke (e.g. any other file importing `DashboardTab` and exhaustively switching over it, which would now need a `"home"` case).

- [ ] **Step 2: Attempt manual browser walkthrough**

Start the dev server (`bun run dev` from repo root, or `cd apps/landing && bun run dev`) and visit `/dashboard` in a browser. Confirm:
- The page loads directly on the new Home tab (no click needed).
- The three stat cards render (loading → empty-state or real data).
- The memory panel renders.
- The feedback link is present and points to the GitHub issues URL.
- Clicking each card/link switches to the correct tab.

If the sandbox has no reachable backend (the same sign-in-redirect blocker hit for every UI feature this session — landing redirects to `/signin` because there's no live session), report that explicitly rather than trying to work around it. Do not fabricate a "verified" result.

- [ ] **Step 3: Report status**

Summarize: tests/typecheck/lint pass/fail, and whether manual verification succeeded or hit the expected sandbox blocker.
