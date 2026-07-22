# Dashboard Home — Plan & Credits Banner — Design

## Context

The dashboard home page (`docs/superpowers/specs/2026-07-22-dashboard-home-page-design.md`,
shipped this session) has three stat cards (History, Automations, Activity)
and a memory panel, but no plan/billing/credits information — that data only
appears in the `billing` tab, reachable via the gear-icon `SettingsMenu`. The
user flagged this as important: plan and credit balance should be visible on
Home by default, not buried behind a settings menu click.

## Goal

Surface a compact plan/credits summary at the top of the Home tab, backed
entirely by data the page already fetches — no new backend work, no new
fetches.

## Design

A full-width banner rendered above the three stat cards in
`DashboardHome.tsx`, showing:

- **Current plan** — plan name (e.g. "Pro") + a status badge ("owner" /
  "active" / "past due" / "trial"), styled identically to the existing badge
  in the `billing` tab's plan card (`page.tsx:1226-1247`).
- **Renewal date**, if `sub.currentPeriodEnd` is set.
- **Credits remaining** — `creditRemaining / creditTotal available`, plus the
  same caption text produced by the existing `creditsCaption()` helper
  (trial-expiry / renewal / included-monthly wording), matching the `billing`
  tab's credits card (`page.tsx:1289-1308`).
- **Billing warning**, if `sub.billingWarning` is set (payment past due) —
  shown as a small warning strip at the top of the banner, so it's visible
  without opening the `billing` tab.

The whole banner is a `<button>` that navigates to the `billing` tab on
click, matching the existing stat-card click-through pattern. It is
**read-only** — no inline upgrade/cancel/buy-credits actions. Those stay
in the `billing` tab, which is unchanged by this feature.

## Data flow

Zero new fetches. `page.tsx` already computes everything needed,
unconditionally on mount, independent of `activeTab`
(`page.tsx:679-693`: `sub`, `usageSummary`, `creditRemaining`, `creditUsed`,
`creditTotal`, `creditIncluded`, `resetAt`, `resetKind`, `currentPlanKey`,
`isOwner`, `subPending`), plus the module-level `PLANS` array and
`creditsCaption()` helper already used by the `billing` tab.

`page.tsx` assembles a single `PlanSummary` object from these existing values
(duplicating the ~10-line status-tone/label ternary already present in the
`billing` tab's badge — a one-off, not worth extracting into a shared helper
for a single call site) and passes it to `DashboardHome` as a new `plan`
prop:

```ts
export type PlanSummary = {
  loading: boolean          // subPending
  available: boolean        // !!sub
  planName: string          // PLANS.find(p => p.key === currentPlanKey)?.name
  statusLabel: string       // "owner" | "past due" | "trial" | sub.status
  statusTone: "owner" | "active" | "past_due" | "trial"
  isOwner: boolean
  creditRemaining: number
  creditTotal: number       // creditTotal || creditIncluded
  caption: string           // creditsCaption(creditIncluded, isOwner, resetAt, resetKind)
  renewsAt: string | null   // sub?.currentPeriodEnd ?? null
  billingWarning: string | null
}
```

`DashboardHome` renders it as pure presentation — same convention as the
existing `StatCard` sub-component (Task 1 of the home-page plan): no fetching,
no local state beyond what's already in the component for the stat cards.

## Loading / empty states

- `plan.loading` (mirrors `subPending`): plan name renders as `"…"`.
- `!plan.available` (mirrors `sub` being null after a failed load, i.e. the
  existing `subLoadError` case): plan name renders as `"Unavailable"`, no
  status badge.
- `plan.isOwner`: credit balance renders as `"∞"`, no `/ total` suffix —
  matching the `billing` tab's existing owner treatment exactly.

## Testing

No automated test — consistent with every UI feature shipped this session
and with the home-page feature this extends. Verification is
typecheck/lint/test plus an attempted manual browser walkthrough (the same
sign-in-redirect sandbox blocker is expected).
