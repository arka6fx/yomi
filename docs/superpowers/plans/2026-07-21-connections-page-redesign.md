# Dashboard Connections Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the connections page's card grid with a dense row-list layout, grouped by the existing 12 categories, and add a "next step" callout that recommends the highest-priority unconnected connector.

**Architecture:** All rendering logic lives in `packages/ui-connectors` (a portable, framework-light component package using inline styles against a `ConnectorTheme` token object, not Tailwind). `apps/landing/src/app/dashboard/page.tsx` only gains one new component call; it doesn't grow further. A new pure function (`pickNextStep`) drives the callout and is the only piece of this feature with automated tests — the rest is unstyled-React-with-no-test-harness, same as the rest of this package today.

**Tech Stack:** TypeScript, React (inline styles, no CSS framework), Bun test.

## Global Constraints

- Full design rationale, rejected alternatives, and exact wording live in
  `docs/superpowers/specs/2026-07-21-connections-page-redesign-design.md`
  — read it if anything here seems underspecified.
- `category` values must come from `ui-connectors`' own `ConnectorCategory`
  (`packages/ui-connectors/src/types.ts`) — **not** `agent-core`'s
  same-named but different type. Verified against `catalog.ts`: `notion`
  and `linear` are `"productivity"` here, not `"knowledge"`/`"engineering"`.
- Category grouping logic in `ConnectorMarketplace` is unchanged — only
  what renders per connector and per group changes.
- The `highlighted`/`highlightId` prop plumbing (scroll-into-view + accent
  highlight) from the earlier integration-nudge feature must keep working
  unchanged — it matches on `info.id`, not on DOM structure, so it survives
  the card→row change as long as the tile keeps a ref and an
  `id={`connector-${info.id}`}` attribute.
- No new database state, no new backend endpoints — this is a pure
  frontend/component change.
- This package (`ui-connectors`) has no React component test harness —
  only pure functions get automated tests. Verify components with
  typecheck + lint; the final manual browser check needs a real signed-in
  session (this sandbox's dev environment can't reach the backend/DB, so
  it can't get past the dashboard's sign-in redirect — confirmed when
  building the `highlightId` prop in the prior feature).

---

### Task 1: `pickNextStep` — priority-list logic

**Files:**
- Create: `packages/ui-connectors/src/components/NextStepCard.tsx`
- Create: `packages/ui-connectors/src/components/NextStepCard.test.ts`

**Interfaces:**
- Consumes: `ConnectorCategory` type from `../types` (existing).
- Produces: `export interface NextStepSuggestion { id: string; name:
  string; category: ConnectorCategory; reason: string }` and `export
  function pickNextStep(connectedIds: string[]): NextStepSuggestion |
  null` — consumed by Task 2 (the `NextStepCard` component) and its own
  tests.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui-connectors/src/components/NextStepCard.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { pickNextStep } from "./NextStepCard.js"

describe("pickNextStep", () => {
  it("returns the first unconnected suggestion in priority order", () => {
    const result = pickNextStep([])
    expect(result?.id).toBe("google-calendar")
  })

  it("skips connected entries and returns the next one in priority order", () => {
    const result = pickNextStep(["google-calendar", "google-drive"])
    expect(result?.id).toBe("slack")
  })

  it("returns null once every priority entry is connected", () => {
    const result = pickNextStep([
      "google-calendar",
      "google-drive",
      "slack",
      "notion",
      "github",
      "google-tasks",
      "linear",
    ])
    expect(result).toBeNull()
  })

  it("ignores connected ids that aren't on the priority list", () => {
    const result = pickNextStep(["gmail", "swiggy", "figma"])
    expect(result?.id).toBe("google-calendar")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/ui-connectors && bun test src/components/NextStepCard.test.ts`
Expected: FAIL with "Cannot find module './NextStepCard.js'"

- [ ] **Step 3: Write the implementation**

Create `packages/ui-connectors/src/components/NextStepCard.tsx`:

```tsx
"use client"

import type { ConnectorCategory, ConnectorTheme } from "../types"

export interface NextStepSuggestion {
  id: string
  name: string
  category: ConnectorCategory
  reason: string
}

// Ordered by what unlocks the most value first. Deliberately short — this
// is a "get the essentials connected" nudge, not a completion tracker, so
// it disappears once these are done even if dozens of niche connectors
// remain unconnected. Categories checked against catalog.ts (ui-connectors'
// own ConnectorCategory, not agent-core's differently-shaped type).
const NEXT_STEP_PRIORITY: NextStepSuggestion[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "productivity",
    reason: "Yomi can already read your email — add your calendar so it can schedule things too.",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "productivity",
    reason: "Let Yomi search, create, and edit your files, not just email.",
  },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    reason: "Read and send Slack messages from Telegram.",
  },
  {
    id: "notion",
    name: "Notion",
    category: "productivity",
    reason: "Search and update your Notion workspace.",
  },
  {
    id: "github",
    name: "GitHub",
    category: "developer",
    reason: "Check PRs, issues, and repos without leaving the chat.",
  },
  {
    id: "google-tasks",
    name: "Google Tasks",
    category: "productivity",
    reason: "Add and check off tasks by just asking.",
  },
  {
    id: "linear",
    name: "Linear",
    category: "productivity",
    reason: "Track and update Linear issues from Telegram.",
  },
]

export function pickNextStep(connectedIds: string[]): NextStepSuggestion | null {
  const connected = new Set(connectedIds)
  return NEXT_STEP_PRIORITY.find((s) => !connected.has(s.id)) ?? null
}
```

(The `NextStepCard` component itself is added in Task 2 — this step only
needs `pickNextStep` to exist for the tests to pass.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/ui-connectors && bun test src/components/NextStepCard.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `cd packages/ui-connectors && bun run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/ui-connectors/src/components/NextStepCard.tsx packages/ui-connectors/src/components/NextStepCard.test.ts
git commit -m "feat(ui-connectors): add pickNextStep priority-list logic"
```

---

### Task 2: `NextStepCard` component + package export

**Files:**
- Modify: `packages/ui-connectors/src/components/NextStepCard.tsx`
- Modify: `packages/ui-connectors/src/index.ts`

**Interfaces:**
- Consumes: `pickNextStep`, `NextStepSuggestion` from Task 1. `ConnectorTheme` from `../types` (existing).
- Produces: `export function NextStepCard({ connectedIds, theme, appUrl }: { connectedIds: string[]; theme: ConnectorTheme; appUrl: string }): JSX.Element | null` — consumed by Task 5. `NextStepCard`, `pickNextStep`, and `type NextStepSuggestion` exported from `@yomi/ui-connectors`'s package root — consumed by Task 5.

No automated test for this step — this package has no React component
test harness (confirmed: only `catalog.test.ts` exists, and it tests plain
data / the pure `accountLabel` function, not rendering). Verify with
typecheck + lint.

- [ ] **Step 1: Add the component**

Append to `packages/ui-connectors/src/components/NextStepCard.tsx`:

```tsx
export function NextStepCard({
  connectedIds,
  theme: t,
  appUrl,
}: {
  connectedIds: string[]
  theme: ConnectorTheme
  appUrl: string
}) {
  const suggestion = pickNextStep(connectedIds)
  if (!suggestion) return null

  return (
    <div
      style={{
        background: `${t.accent}1f`,
        border: `1px solid ${t.accent}59`,
        borderRadius: 14,
        padding: 16,
        marginBottom: 18,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          fontWeight: 700,
          color: t.accent,
          textTransform: "uppercase" as const,
          marginBottom: 4,
          fontFamily: t.font,
        }}
      >
        Next step
      </div>
      <div
        style={{
          color: t.text,
          fontSize: 15,
          fontWeight: 600,
          marginBottom: 4,
          fontFamily: t.font,
        }}
      >
        Connect {suggestion.name}
      </div>
      <p
        style={{
          color: t.dim,
          fontSize: 12,
          margin: "0 0 10px 0",
          fontFamily: t.font,
        }}
      >
        {suggestion.reason}
      </p>
      <a
        href={`${appUrl}/dashboard?connect=${suggestion.id}`}
        style={{
          display: "inline-block",
          background: t.accent,
          color: t.accentText,
          border: "none",
          borderRadius: 6,
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: t.font,
          textDecoration: "none",
        }}
      >
        Connect →
      </a>
    </div>
  )
}
```

(The `${t.accent}1f` / `${t.accent}59` hex-alpha-suffix pattern is already
used in `ConnectorTile`'s highlight styling — both current themes'
`accent` value is a hex color, so this is consistent with existing code,
not a new assumption.)

- [ ] **Step 2: Export from the package root**

In `packages/ui-connectors/src/index.ts`, change:

```ts
export { ConnectorMarketplace, ConnectorTile } from "./components/ConnectorMarketplace"
export { ConnectorIcon } from "./icons"
export { buildCatalog } from "./catalog"
export type { ConnectorInfo, ConnectorTheme, ConnectorCategory } from "./types"
export { DARK_THEME, LIGHT_THEME } from "./types"
```

to:

```ts
export { ConnectorMarketplace, ConnectorTile } from "./components/ConnectorMarketplace"
export { NextStepCard, pickNextStep } from "./components/NextStepCard"
export { ConnectorIcon } from "./icons"
export { buildCatalog } from "./catalog"
export type { ConnectorInfo, ConnectorTheme, ConnectorCategory } from "./types"
export type { NextStepSuggestion } from "./components/NextStepCard"
export { DARK_THEME, LIGHT_THEME } from "./types"
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd packages/ui-connectors && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 4: Run the test suite to confirm no regressions**

Run: `cd packages/ui-connectors && bun test`
Expected: PASS, includes the 4 `pickNextStep` tests plus all pre-existing `catalog.test.ts` tests

- [ ] **Step 5: Commit**

```bash
git add packages/ui-connectors/src/components/NextStepCard.tsx packages/ui-connectors/src/index.ts
git commit -m "feat(ui-connectors): add NextStepCard component and export it"
```

---

### Task 3: Row layout for `ConnectorTile` / `ConnectorMarketplace`

**Files:**
- Modify: `packages/ui-connectors/src/components/ConnectorMarketplace.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no interface changes — `ConnectorTileProps` and
  `ConnectorMarketplaceProps` keep their exact current shape (`info`, `t`,
  `onConnect`, `onDisconnect`, `loading`, `limitReached`, `highlighted` /
  `highlightId`). This is a rendering-only change.

No automated test — component rendering, no test harness in this package.
Verify with typecheck + lint; visual confirmation happens in Task 6's
manual check.

- [ ] **Step 1: Replace `ConnectorTile`'s card body with a row**

In `packages/ui-connectors/src/components/ConnectorMarketplace.tsx`, find
the entire `return (...)` block inside `ConnectorTile` (from `return (` at
the top of the function through its closing `)` — currently lines 114–296,
i.e. everything between `function handleDisconnectClick() { ... }` and the
`}` that closes `ConnectorTile`) and replace it with:

```tsx
  return (
    <div
      ref={tileRef}
      id={`connector-${info.id}`}
      onMouseEnter={(e) => {
        if (info.available) e.currentTarget.style.borderColor = t.borderHi
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = highlighted ? t.accent : "transparent"
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 8px",
        borderRadius: 10,
        border: "1px solid transparent",
        borderBottom: `1px solid ${t.border}`,
        ...(highlighted
          ? {
              borderColor: t.accent,
              boxShadow: `0 0 0 2px ${t.accent}40`,
              background: `${t.accent}0d`,
            }
          : {}),
        opacity: !info.available ? 0.55 : 1,
        boxSizing: "border-box" as const,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: t.btnBg,
          border: `1px solid ${t.borderHi}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <ConnectorIcon id={info.id} size={17} />
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" as const }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: t.text,
              fontFamily: t.font,
              flexShrink: 0,
            }}
          >
            {info.name}
          </span>
          {!info.available && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: t.dim,
                background: t.btnBg,
                border: `1px solid ${t.border}`,
                padding: "1px 6px",
                borderRadius: 4,
                textTransform: "uppercase" as const,
                flexShrink: 0,
              }}
            >
              Soon
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              color: t.dim,
              fontFamily: t.font,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap" as const,
              minWidth: 0,
            }}
          >
            {info.description}
          </span>
        </div>
        {info.connected && <AccountLine t={t} displayName={info.displayName} />}
      </div>

      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
        {info.connected && <ConnectedBadge t={t} />}
        {info.available &&
          (info.connected ? (
            <button
              onClick={handleDisconnectClick}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = t.accent
                e.currentTarget.style.borderColor = t.accent
              }}
              onMouseLeave={(e) => {
                setConfirmDisconnect(false)
                e.currentTarget.style.color = t.dim
                e.currentTarget.style.borderColor = t.border
              }}
              disabled={loading}
              style={{
                fontFamily: t.font,
                fontSize: 11,
                fontWeight: 600,
                color: confirmDisconnect ? t.accent : t.dim,
                background: "transparent",
                border: `1px solid ${confirmDisconnect ? t.accent : t.border}`,
                borderRadius: 6,
                padding: "4px 10px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap" as const,
              }}
            >
              {loading ? "Disconnecting..." : confirmDisconnect ? "Confirm?" : "Disconnect"}
            </button>
          ) : limitReached ? (
            <span
              style={{
                fontFamily: t.font,
                fontSize: 10,
                fontWeight: 600,
                color: t.dim,
                whiteSpace: "nowrap" as const,
              }}
            >
              Limit reached — upgrade to connect
            </span>
          ) : (
            <button
              onClick={() => onConnect(info.id)}
              disabled={loading}
              style={{
                fontFamily: t.font,
                fontSize: 11,
                fontWeight: 600,
                color: t.btnText,
                background: t.btnBg,
                border: `1px solid ${t.border}`,
                borderRadius: 6,
                padding: "4px 10px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap" as const,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = t.accent
                e.currentTarget.style.color = t.accentText
                e.currentTarget.style.borderColor = t.accent
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = t.btnBg
                e.currentTarget.style.color = t.btnText
                e.currentTarget.style.borderColor = t.border
              }}
            >
              {info.authKind === "api_key"
                ? "Add API key"
                : info.authKind === "connection_string"
                  ? "Add connection string"
                  : "Connect"}
            </button>
          ))}
      </div>
    </div>
  )
```

This preserves every existing behavior — the double-click-to-confirm
disconnect flow, the `loading` disabled state, the `limitReached` state,
the `authKind`-based button label, `AccountLine`/`ConnectedBadge` — only
the container structure changes from a vertical card to a horizontal row,
and the "Soon" badge / connected badge / buttons move from below the name
to inline / right-aligned.

- [ ] **Step 2: Replace the per-category grid with a plain list, and fix `CATEGORY_LABELS`**

Find:

```tsx
const CATEGORY_LABELS: Record<string, string> = {
  email: "Email",
  productivity: "Productivity",
  "file-storage": "File Storage",
  engineering: "Engineering",
  knowledge: "Knowledge",
  "data-analytics": "Data & Analytics",
  data: "Databases",
  crm: "CRM",
  support: "Support",
  finance: "Finance",
  design: "Design",
  security: "Security",
  hr: "HR",
  meetings: "Meetings",
  developer: "Developer",
  communication: "Communication",
}
```

Change to (typed against the real `ConnectorCategory` union so a missing
or stale entry is a compile error, not a silent fallback to the raw
string — the old map had six categories, like `"engineering"`/`"knowledge"`,
that don't exist in this package's `ConnectorCategory` at all, and was
missing four, like `"customer-support"`/`"food"`, that do):

```tsx
const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  productivity: "Productivity",
  "file-storage": "File Storage",
  "file-management": "File Management",
  email: "Email",
  "data-analytics": "Data & Analytics",
  crm: "CRM",
  communication: "Communication",
  developer: "Developer",
  data: "Databases",
  meetings: "Meetings",
  food: "Food",
  finance: "Finance",
  "customer-support": "Customer Support",
  other: "Other",
}
```

Add `ConnectorCategory` to the type-only import at the top of the file:

```ts
import type { ConnectorInfo, ConnectorTheme } from "../types"
```

becomes:

```ts
import type { ConnectorCategory, ConnectorInfo, ConnectorTheme } from "../types"
```

Then find, inside `ConnectorMarketplace`:

```tsx
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))",
                gap: 14,
              }}
            >
              {group.map((info) => (
```

Change to:

```tsx
            <div>
              {group.map((info) => (
```

(No other change needed in this block — the closing `</div>` and the
`ConnectorTile` props below it are unaffected.)

- [ ] **Step 3: Typecheck and lint**

Run: `cd packages/ui-connectors && bun run typecheck && bun run lint`
Expected: no errors — the `Record<ConnectorCategory, string>` change will
fail to compile if any category is missing, which confirms the fix is
complete.

- [ ] **Step 4: Commit**

```bash
git add packages/ui-connectors/src/components/ConnectorMarketplace.tsx
git commit -m "feat(ui-connectors): switch connector list from cards to rows"
```

---

### Task 4: Theme token refinement

**Files:**
- Modify: `packages/ui-connectors/src/types.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no shape change to `ConnectorTheme` — only the values inside
  `DARK_THEME`/`LIGHT_THEME` change.

No automated test — visual values, no test harness. Verify with
typecheck; visual confirmation happens in Task 6's manual check.

- [ ] **Step 1: Adjust `DARK_THEME`**

Find:

```ts
export const DARK_THEME: ConnectorTheme = {
  bg: "rgba(5, 8, 18, 0.4)",
  surface: "rgba(10, 14, 28, 0.58)",
  border: "rgba(255,255,255,0.07)",
  borderHi: "rgba(255,255,255,0.14)",
```

Change to:

```ts
export const DARK_THEME: ConnectorTheme = {
  bg: "rgba(5, 8, 18, 0.4)",
  surface: "rgba(14, 17, 30, 0.6)",
  border: "rgba(255,255,255,0.09)",
  borderHi: "rgba(255,255,255,0.16)",
```

(Row dividers need to read as a visible-but-quiet line, not a full card
border — the old 0.07 alpha was tuned for a bordered card with backdrop
blur behind it, not a bare 1px divider. `surface` gets a touch warmer/
lighter so the "next step" callout and connected badges keep enough
contrast against it.)

- [ ] **Step 2: Adjust `LIGHT_THEME`**

Find:

```ts
export const LIGHT_THEME: ConnectorTheme = {
  bg: "#ffffff",
  surface: "#f9f9f9",
  border: "rgba(0,0,0,0.1)",
  borderHi: "rgba(0,0,0,0.2)",
```

Change to:

```ts
export const LIGHT_THEME: ConnectorTheme = {
  bg: "#ffffff",
  surface: "#f8f8f7",
  border: "rgba(0,0,0,0.12)",
  borderHi: "rgba(0,0,0,0.22)",
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/ui-connectors && bun run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui-connectors/src/types.ts
git commit -m "style(ui-connectors): retune theme tokens for row dividers"
```

---

### Task 5: Wire `NextStepCard` into the dashboard

**Files:**
- Modify: `apps/landing/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `NextStepCard` from `@yomi/ui-connectors` (Task 2). Existing
  `connectedProviders: string[]` state and `DARK_THEME` (already imported).
- Produces: nothing consumed elsewhere — end of the chain.

No automated test (no React test harness in this app either — confirmed
in the prior feature's Task 5). Verified by running the app and checking
the integrations tab, per this project's `run` skill — same limitation as
before: this sandbox can't reach the backend/DB, so the check needs a
real signed-in session.

- [ ] **Step 1: Add the import**

Find:

```tsx
import { ConnectorMarketplace, buildCatalog, DARK_THEME } from "@yomi/ui-connectors"
```

Change to:

```tsx
import { ConnectorMarketplace, NextStepCard, buildCatalog, DARK_THEME } from "@yomi/ui-connectors"
```

- [ ] **Step 2: Render it above `ConnectorMarketplace`**

Find (inside the `activeTab === "integrations"` block, immediately before
the `<ConnectorMarketplace` call):

```tsx
            <ConnectorMarketplace
              connectors={buildCatalog(
                connectedProviders,
                Object.fromEntries(integrationHealth.map((i) => [i.provider, i.displayName])),
              )}
              theme={DARK_THEME}
              onConnect={handleConnectIntegration}
              onDisconnect={handleDisconnectIntegration}
              loadingId={integrationLoadingId}
              highlightId={highlightConnectorId}
            />
```

Change to:

```tsx
            <NextStepCard
              connectedIds={connectedProviders}
              theme={DARK_THEME}
              appUrl={window.location.origin}
            />
            <ConnectorMarketplace
              connectors={buildCatalog(
                connectedProviders,
                Object.fromEntries(integrationHealth.map((i) => [i.provider, i.displayName])),
              )}
              theme={DARK_THEME}
              onConnect={handleConnectIntegration}
              onDisconnect={handleDisconnectIntegration}
              loadingId={integrationLoadingId}
              highlightId={highlightConnectorId}
            />
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(landing): show the next-step callout on the connections tab"
```

---

### Task 6: Whole-monorepo verification and manual check

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no new errors (pre-existing warnings in unrelated files are
fine, per this session's established baseline)

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: PASS, `ui-connectors` now shows 4 additional `pickNextStep`
tests, no regressions elsewhere

- [ ] **Step 3: Attempt a manual browser check**

Use this project's `run` skill to start the dev server and visit
`/dashboard`. If this environment can reach a real backend/DB and you can
sign in: confirm the "Next step" callout appears above the connectors
list, recommending the first unconnected priority connector; confirm the
connectors below render as rows grouped by category, not cards; confirm
clicking the callout's Connect link lands on `?connect=<id>` and
scrolls/highlights that row (reusing Task 5 from the prior feature's
wiring, unchanged here).

If sign-in isn't reachable (as it wasn't in this sandbox during the prior
feature's implementation): report that clearly rather than guessing, and
tell the user this specific check needs to happen on a machine with a
real session.

- [ ] **Step 4: Final commit check**

Run: `git status --short`
Expected: clean (everything from Tasks 1–5 already committed per-task)
