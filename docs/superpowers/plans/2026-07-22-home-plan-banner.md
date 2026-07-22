# Dashboard Home — Plan & Credits Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only plan/credits summary banner to the top of the dashboard Home tab, click-through to the `billing` tab, using data the page already fetches.

**Architecture:** A new `PlanBanner` presentational sub-component inside `DashboardHome.tsx` (same file, same convention as the existing `StatCard`), driven by a new `PlanSummary` object type. `page.tsx` assembles that object from state it already computes unconditionally on mount and passes it down as a new `plan` prop.

**Tech Stack:** Next.js (App Router), React, Tailwind, lucide-react — `apps/landing`.

## Global Constraints

- No new fetches, no new backend routes — `plan` is built entirely from `page.tsx`'s existing `sub`/`usageSummary`-derived state.
- Read-only banner: click navigates to the `billing` tab; no inline upgrade/cancel/buy-credits actions (that stays exclusively in the `billing` tab, unchanged).
- No automated frontend test, consistent with every UI feature shipped this session.

---

### Task 1: `PlanBanner` component and wiring

Both files must change together — `DashboardHome`'s prop signature gains a required `plan` prop in this task, and `page.tsx`'s existing call site must supply it in the same task, so no commit lands with `page.tsx` failing to typecheck against `DashboardHome`'s new required prop.

**Files:**
- Modify: `apps/landing/src/components/dashboard/DashboardHome.tsx`
- Modify: `apps/landing/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `Sub` type (`page.tsx:61-89`, fields `role`, `plan`, `status`, `currentPeriodEnd`, `billingWarning`), `PLANS` array and `creditsCaption()` helper (both already defined in `page.tsx`, already used by the `billing` tab at `page.tsx:1204-1308`), and the existing derived consts `isOwner`, `currentPlanKey`, `creditRemaining`, `creditTotal`, `creditIncluded`, `resetAt`, `resetKind`, `subPending` (`page.tsx:681-693`).
- Produces: `export type PlanSummary` from `DashboardHome.tsx` (fields: `loading`, `available`, `planName`, `statusLabel`, `statusTone`, `isOwner`, `creditRemaining`, `creditTotal`, `caption`, `renewsAt`, `billingWarning`) and `DashboardHome`'s prop signature now requires `plan: PlanSummary` in addition to the existing `token`, `recentActivity`, `onNavigate`.

- [ ] **Step 1: Add the `AlertTriangle` icon and `cn` util import to `DashboardHome.tsx`**

In `apps/landing/src/components/dashboard/DashboardHome.tsx`, find:

```tsx
import { Activity, Brain, Clock, ExternalLink, Loader2, MessageSquare } from "lucide-react"
import type { DashboardTab } from "./SettingsMenu"
```

Change to:

```tsx
import { Activity, AlertTriangle, Brain, Clock, ExternalLink, Loader2, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import type { DashboardTab } from "./SettingsMenu"
```

- [ ] **Step 2: Add the `PlanSummary` type and tone-class map**

Find:

```tsx
export type ActivityItem = {
  id: string
  label: string
  category: string
  credits: number
  createdAt: string
}

function truncate(text: string, max: number) {
```

Change to:

```tsx
export type ActivityItem = {
  id: string
  label: string
  category: string
  credits: number
  createdAt: string
}

export type PlanSummary = {
  loading: boolean
  available: boolean
  planName: string
  statusLabel: string
  statusTone: "owner" | "active" | "past_due" | "trial"
  isOwner: boolean
  creditRemaining: number
  creditTotal: number
  caption: string
  renewsAt: string | null
  billingWarning: string | null
}

const PLAN_TONE_CLASSES: Record<PlanSummary["statusTone"], string> = {
  owner: "bg-sky-500/10 text-sky-300",
  active: "bg-emerald-500/10 text-emerald-400",
  past_due: "bg-red-500/10 text-red-400",
  trial: "bg-sky-500/10 text-sky-300",
}

function truncate(text: string, max: number) {
```

- [ ] **Step 3: Add the `PlanBanner` sub-component**

Find:

```tsx
function relativeFuture(value: string) {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  if (minutes <= 0) return "any moment"
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

function StatCard({
```

Change to (inserts `PlanBanner` between `relativeFuture` and `StatCard`):

```tsx
function relativeFuture(value: string) {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  if (minutes <= 0) return "any moment"
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

function PlanBanner({ plan, onClick }: { plan: PlanSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-border bg-card p-5 sm:p-6 text-left transition-colors hover:border-primary/40"
    >
      {plan.billingWarning && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
          <AlertTriangle size={13} className="shrink-0" />
          {plan.billingWarning}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            Current plan
          </p>
          <div className="flex items-center gap-2">
            <span
              className="text-2xl font-light text-foreground capitalize"
              style={{ letterSpacing: "-0.02em" }}
            >
              {plan.loading ? "…" : plan.available ? plan.planName : "Unavailable"}
            </span>
            {!plan.loading && plan.available && (
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  PLAN_TONE_CLASSES[plan.statusTone],
                )}
              >
                {plan.statusLabel}
              </span>
            )}
          </div>
          {plan.renewsAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Renews{" "}
              {new Date(plan.renewsAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            Credits remaining
          </p>
          <div className="flex items-baseline justify-end gap-2">
            <span className="text-3xl font-light text-foreground tabular-nums">
              {plan.isOwner ? "∞" : plan.creditRemaining}
            </span>
            {!plan.isOwner && (
              <span className="text-sm text-muted-foreground">/ {plan.creditTotal} available</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{plan.caption}</p>
        </div>
      </div>
    </button>
  )
}

function StatCard({
```

- [ ] **Step 4: Add the `plan` prop to `DashboardHome`**

Find:

```tsx
export function DashboardHome({
  token,
  recentActivity,
  onNavigate,
}: {
  token: string
  recentActivity: ActivityItem[]
  onNavigate: (tab: DashboardTab) => void
}) {
```

Change to:

```tsx
export function DashboardHome({
  token,
  recentActivity,
  plan,
  onNavigate,
}: {
  token: string
  recentActivity: ActivityItem[]
  plan: PlanSummary
  onNavigate: (tab: DashboardTab) => void
}) {
```

- [ ] **Step 5: Render `PlanBanner` above the stat-card grid**

Find:

```tsx
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
```

Change to:

```tsx
  return (
    <div className="space-y-6">
      <PlanBanner plan={plan} onClick={() => onNavigate("billing")} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
```

- [ ] **Step 6: Import `PlanSummary` in `page.tsx`**

In `apps/landing/src/app/dashboard/page.tsx`, find:

```tsx
import { DashboardHome } from "@/components/dashboard/DashboardHome"
```

Change to:

```tsx
import { DashboardHome, type PlanSummary } from "@/components/dashboard/DashboardHome"
```

- [ ] **Step 7: Build the `planSummary` object in `page.tsx`**

Find:

```tsx
  const recentActivity = usageSummary?.recentActivity ?? []

  return (
```

Change to:

```tsx
  const recentActivity = usageSummary?.recentActivity ?? []

  const planStatusTone: PlanSummary["statusTone"] = isOwner
    ? "owner"
    : sub?.status === "active"
      ? "active"
      : sub?.status === "past_due"
        ? "past_due"
        : "trial"
  const planStatusLabel = isOwner
    ? "owner"
    : sub?.status === "past_due"
      ? "past due"
      : sub?.plan === "explore"
        ? "trial"
        : (sub?.status ?? "trial")
  const planSummary: PlanSummary = {
    loading: subPending,
    available: !!sub,
    planName: sub ? (PLANS.find((p) => p.key === currentPlanKey)?.name ?? currentPlanKey) : "",
    statusLabel: planStatusLabel,
    statusTone: planStatusTone,
    isOwner,
    creditRemaining,
    creditTotal: creditTotal || creditIncluded,
    caption: creditsCaption(creditIncluded, isOwner, resetAt, resetKind),
    renewsAt: sub?.currentPeriodEnd ?? null,
    billingWarning: sub?.billingWarning ?? null,
  }

  return (
```

This mirrors the exact same status-tone/label logic already used by the `billing` tab's plan card badge (`page.tsx:1226-1247`) and the exact same credits caption call already used by its credits card (`page.tsx:1307`) — restated here as a plain object instead of inline JSX conditionals.

- [ ] **Step 8: Pass `plan={planSummary}` to `DashboardHome`**

Find:

```tsx
            <DashboardHome
              token={session.session.token}
              recentActivity={recentActivity}
              onNavigate={setActiveTab}
            />
```

Change to:

```tsx
            <DashboardHome
              token={session.session.token}
              recentActivity={recentActivity}
              plan={planSummary}
              onNavigate={setActiveTab}
            />
```

- [ ] **Step 9: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: both pass with no errors. If `@/lib/utils` fails to resolve from `DashboardHome.tsx`'s location, check `apps/landing/tsconfig.json`'s `paths` config — it maps `@/*` to `./src/*` project-root-relative, so the same alias used throughout `page.tsx` must resolve identically from any file under `src/`.

- [ ] **Step 10: Commit**

```bash
git add apps/landing/src/components/dashboard/DashboardHome.tsx apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(landing): add plan/credits banner to dashboard home"
```

---

### Task 2: Whole-monorepo verification and manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Run full monorepo typecheck, lint, and test**

Run (from repo root): `bun run typecheck && bun run lint && bun run test`
Expected: all pass. This is a frontend-only change with no backend code touched.

- [ ] **Step 2: Attempt manual browser walkthrough**

Visit `/dashboard` in a browser (dev server via `bun run dev`). Confirm:
- The plan/credits banner renders above the three stat cards on the Home tab.
- Plan name, status badge, credit balance, and caption match what the `billing` tab shows for the same account.
- If a billing warning is present, it shows at the top of the banner.
- Clicking the banner switches to the `billing` tab.

If the sandbox has no reachable backend (the same sign-in-redirect blocker hit for every UI feature this session), report that explicitly rather than trying to work around it. Do not fabricate a "verified" result.

- [ ] **Step 3: Report status**

Summarize: tests/typecheck/lint pass/fail, and whether manual verification succeeded or hit the expected sandbox blocker.
