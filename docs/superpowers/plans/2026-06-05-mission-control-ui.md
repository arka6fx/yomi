# Mission Control UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a drop-down "Mission Control" panel under the notch that shows the active automation's live timeline, recent run history with replay, and an approve/deny card for pending risky actions.

**Architecture:** Renderer-only. All data already lands in the Zustand store via `automation_*` / `act_proposed` SSE events; all actions reuse already-wired IPC (`confirmAct`, `replayAutomation`). The authenticated overlay is a full work-area transparent window, so the panel renders in the centered column under `<Notch>` and is auto-picked-up by the existing hit-region observer — no window-resize wiring needed. One scoped refactor extracts theme primitives into `theme.tsx` so the new panel lives in its own `mission/MissionControl.tsx` instead of growing the 4,433-line `app.tsx`.

**Tech Stack:** Electron renderer, React, Zustand, framer-motion, TypeScript, `bun test`.

---

## File Structure

- `apps/desktop/src/renderer/theme.tsx` (new) — extracted theme primitives: `Theme`/`ThemeId` types, theme constants, `THEMES`, `ThemeCtx`, font constants, glass + opacity helpers.
- `apps/desktop/src/renderer/store.ts` (modify) — add `missionsOpen` + `toggleMissions`/`setMissionsOpen`; auto-open on pending approval.
- `apps/desktop/src/renderer/store.test.ts` (new) — unit tests for the missions store logic.
- `apps/desktop/src/renderer/mission/MissionControl.tsx` (new) — the panel and its subcomponents.
- `apps/desktop/src/renderer/app.tsx` (modify) — import theme from `theme.tsx`; add the `◆ Missions` toolbar button; render `<MissionControl/>` under `<Notch/>`.

All commands run from `apps/desktop/` unless noted. The desktop test script is `bun test --pass-with-no-tests`; typecheck is `tsc --noEmit`; build is `bun run build:ci` (electron-vite build).

---

## Task 1: Extract theme primitives into `theme.tsx`

Enabling refactor so `MissionControl.tsx` can import shared theme primitives without a circular dependency on `app.tsx`. This is a pure move — no behavior change. Verified by typecheck + build.

**Files:**
- Create: `apps/desktop/src/renderer/theme.tsx`
- Modify: `apps/desktop/src/renderer/app.tsx`

- [ ] **Step 1: Create `theme.tsx` and move the theme primitives**

Create `apps/desktop/src/renderer/theme.tsx`. Move (cut) these declarations out of `app.tsx` into it, and add `export` to each one listed:

- `type ThemeId` and `interface Theme` (currently ~lines 28-108) → `export type ThemeId`, `export interface Theme`.
- All theme constants `AMBER, BLUE, GREEN, VIOLET, HOTPINK, PURPLE, BLACK` and `const THEMES` (~lines 110-685) → keep as-is, add `export` to `THEMES` only (constants can stay unexported, `THEMES` must be exported).
- `const ThemeCtx = React.createContext(...)` (~lines 687-690) → `export const ThemeCtx`.
- Opacity helpers `OPACITY_STORAGE_KEY`, `UI_OPACITY_EVENT`, `clampUiOpacity`, `readUiOpacity`, `translucentColor` (~lines 695-713) → `export` each that `app.tsx` still references (export all five to be safe).
- Glass helpers `glassPanel`, `glassBar`, `opaqueColor` (~lines 719-730) → `export` each.
- Font constants `UI_FONT`, `DISPLAY_FONT`, `CODE_FONT` (~lines 801-803) → `export const` each.

`theme.tsx` must start with `import React from "react"` (needed for `createContext`).

**Leave in `app.tsx`:** `themeStyleEl`, `applyTheme`, the global `styleEl` block, and `ThemeProvider` — these stay where they are.

- [ ] **Step 2: Add the import to `app.tsx`**

At the top of `app.tsx`, add (merge with existing imports):

```tsx
import {
  type Theme,
  type ThemeId,
  THEMES,
  ThemeCtx,
  UI_FONT,
  DISPLAY_FONT,
  CODE_FONT,
  glassPanel,
  glassBar,
  opaqueColor,
  translucentColor,
  OPACITY_STORAGE_KEY,
  UI_OPACITY_EVENT,
  clampUiOpacity,
  readUiOpacity,
} from "./theme"
```

Remove the now-duplicated declarations from `app.tsx`. If `app.tsx` no longer references some of these directly (e.g. `glassPanel`), drop them from the import to satisfy `noUnusedLocals`.

- [ ] **Step 3: Typecheck**

Run: `tsc --noEmit`
Expected: PASS, no errors. Fix any "Cannot find name" (missed move) or "duplicate identifier" (missed delete) until clean.

- [ ] **Step 4: Build**

Run: `bun run build:ci`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/theme.tsx apps/desktop/src/renderer/app.tsx
git commit -m "refactor: extract theme primitives into theme.tsx"
```

---

## Task 2: Add `missionsOpen` store state, actions, and auto-open

TDD. The store is plain Zustand and testable via `getState()/setState()` outside React.

**Files:**
- Create: `apps/desktop/src/renderer/store.test.ts`
- Modify: `apps/desktop/src/renderer/store.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "bun:test"
import { useYomiStore } from "./store"
import type { AutomationRun } from "@yomi/shared"

function makeRun(id: string): AutomationRun {
  return {
    id,
    owner: { id: "spotify", label: "Spotify Agent" },
    task: "play lofi",
    state: "executing",
    startedAt: new Date().toISOString(),
    timeline: [],
  }
}

beforeEach(() => {
  useYomiStore.setState({
    missionsOpen: false,
    automationRuns: [],
    activeAutomationRunId: null,
    pendingAct: null,
  })
})

describe("missions panel state", () => {
  it("toggles open and closed", () => {
    expect(useYomiStore.getState().missionsOpen).toBe(false)
    useYomiStore.getState().toggleMissions()
    expect(useYomiStore.getState().missionsOpen).toBe(true)
    useYomiStore.getState().toggleMissions()
    expect(useYomiStore.getState().missionsOpen).toBe(false)
  })

  it("setMissionsOpen sets the value explicitly", () => {
    useYomiStore.getState().setMissionsOpen(true)
    expect(useYomiStore.getState().missionsOpen).toBe(true)
    useYomiStore.getState().setMissionsOpen(false)
    expect(useYomiStore.getState().missionsOpen).toBe(false)
  })

  it("auto-opens when a risky act is proposed", () => {
    useYomiStore.getState().handleSseEvent({
      type: "act_proposed",
      id: "a1",
      action: { kind: "click_point", x: 1, y: 1 },
      label: "Open Chrome",
      risky: true,
    })
    expect(useYomiStore.getState().pendingAct).toEqual({ id: "a1", label: "Open Chrome" })
    expect(useYomiStore.getState().missionsOpen).toBe(true)
  })

  it("does not auto-open for a non-risky act", () => {
    useYomiStore.getState().handleSseEvent({
      type: "act_proposed",
      id: "a2",
      action: { kind: "click_point", x: 1, y: 1 },
      label: "Scroll down",
      risky: false,
    })
    expect(useYomiStore.getState().missionsOpen).toBe(false)
  })

  it("auto-opens on a dangerous automation wait", () => {
    const run = makeRun("r1")
    useYomiStore.setState({ automationRuns: [run], activeAutomationRunId: "r1" })
    useYomiStore.getState().handleSseEvent({
      type: "automation_waiting",
      runId: "r1",
      reason: "confirm purchase",
      risk: "dangerous",
    })
    expect(useYomiStore.getState().missionsOpen).toBe(true)
    expect(useYomiStore.getState().automationRuns[0]!.state).toBe("needs_approval")
  })

  it("does not auto-open on a safe automation wait", () => {
    const run = makeRun("r2")
    useYomiStore.setState({ automationRuns: [run], activeAutomationRunId: "r2" })
    useYomiStore.getState().handleSseEvent({
      type: "automation_waiting",
      runId: "r2",
      reason: "thinking",
      risk: "safe",
    })
    expect(useYomiStore.getState().missionsOpen).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/renderer/store.test.ts`
Expected: FAIL — `toggleMissions`/`setMissionsOpen` are not functions and `missionsOpen` is `undefined`.

- [ ] **Step 3: Add the state and actions to the interface**

In `apps/desktop/src/renderer/store.ts`, in `interface YomiState`, after `activeAutomationRunId: string | null` add:

```ts
  missionsOpen: boolean
```

And in the actions block (after `replayAutomation`) add:

```ts
  toggleMissions: () => void
  setMissionsOpen: (open: boolean) => void
```

- [ ] **Step 4: Initialise state and implement the actions**

In the `create<YomiState>((set) => ({ ... }))` initial values, after `activeAutomationRunId: null,` add:

```ts
  missionsOpen: false,
```

Add the action implementations near `replayAutomation`:

```ts
  toggleMissions: () => set((s) => ({ missionsOpen: !s.missionsOpen })),
  setMissionsOpen: (missionsOpen) => set({ missionsOpen }),
```

- [ ] **Step 5: Auto-open on a pending approval**

In `handleSseEvent`, change the `act_proposed` case from:

```ts
      case "act_proposed":
        // Risky actions wait for the user's go-ahead (Spec 16).
        if (event.risky) set({ pendingAct: { id: event.id, label: event.label } })
        break
```

to:

```ts
      case "act_proposed":
        // Risky actions wait for the user's go-ahead (Spec 16). Surface the
        // approval in Mission Control so it can't be missed.
        if (event.risky)
          set({ pendingAct: { id: event.id, label: event.label }, missionsOpen: true })
        break
```

- [ ] **Step 6: Auto-open on a dangerous automation wait**

In the `automation_waiting` case, add `missionsOpen` to the returned patch so a dangerous (graph-level) wait opens the panel. Change:

```ts
      case "automation_waiting":
        set((s) => ({
          activeAutomationRunId: event.runId,
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? { ...run, state: event.risk === "dangerous" ? "needs_approval" : "waiting", currentStep: event.reason }
              : run,
          ),
        }))
        break
```

to:

```ts
      case "automation_waiting":
        set((s) => ({
          activeAutomationRunId: event.runId,
          missionsOpen: event.risk === "dangerous" ? true : s.missionsOpen,
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? { ...run, state: event.risk === "dangerous" ? "needs_approval" : "waiting", currentStep: event.reason }
              : run,
          ),
        }))
        break
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test src/renderer/store.test.ts`
Expected: PASS — all six tests green.

- [ ] **Step 8: Typecheck**

Run: `tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/store.test.ts
git commit -m "feat: mission panel store state and auto-open"
```

---

## Task 3: Build the `MissionControl` component

The panel and its subcomponents. Pure, prop/store-driven. Theme via `ThemeCtx` (matches existing `Notch`/`Toolbar` pattern). Verified by typecheck (no renderer component-test harness exists in the repo).

**Files:**
- Create: `apps/desktop/src/renderer/mission/MissionControl.tsx`

- [ ] **Step 1: Write the component**

Create `apps/desktop/src/renderer/mission/MissionControl.tsx`:

```tsx
import React from "react"
import { AnimatePresence, motion } from "framer-motion"
import type { AutomationRun, AutomationTimelineItem } from "@yomi/shared"
import { useYomiStore } from "../store"
import { ThemeCtx, UI_FONT, glassBar } from "../theme"

// ── Mission Control panel (Spec 18) ─────────────────────────────────────────
// Drops under the notch when the Missions toolbar button is toggled. Surfaces
// the active automation's live timeline, recent run history with replay, and an
// approval card for pending risky actions. Renderer-only: data from the store,
// actions via already-wired IPC.

const PANEL_WIDTH = 360

function runGlyph(state: AutomationRun["state"]): string {
  if (state === "completed") return "✓"
  if (state === "failed") return "✗"
  if (state === "recovering") return "↻"
  return "▶"
}

// Approve/deny a pending risky action — reuses the wired act-bus confirm.
function ApprovalCard() {
  const { theme: t } = React.useContext(ThemeCtx)
  const pendingAct = useYomiStore((s) => s.pendingAct)
  const clearPendingAct = useYomiStore((s) => s.clearPendingAct)
  if (!pendingAct) return null
  const resolve = (approved: boolean) => {
    window.yomi.confirmAct(pendingAct.id, approved)
    clearPendingAct()
  }
  const btn = (color: string, bg: string, border: string): React.CSSProperties => ({
    flex: 1,
    fontFamily: UI_FONT,
    fontSize: 11,
    borderRadius: 6,
    padding: "5px 0",
    color,
    background: bg,
    border: `1px solid ${border}`,
  })
  return (
    <div
      style={{
        background: t.upgradeBg,
        border: `1px solid ${t.upgradeBorder}`,
        borderRadius: 8,
        padding: "9px 10px",
        marginBottom: 10,
      }}
    >
      <div style={{ fontSize: 11, color: t.text, marginBottom: 8, lineHeight: 1.4 }}>
        <span style={{ color: t.accent }}>⚠</span> Approve action: <strong>{pendingAct.label}</strong>?
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => resolve(true)} style={btn(t.accent, t.accentD, t.borderHi)}>
          ✓ Approve
        </button>
        <button onClick={() => resolve(false)} style={btn(t.error, t.errorD, t.error)}>
          ✗ Deny
        </button>
      </div>
    </div>
  )
}

function Timeline({ items }: { items: AutomationTimelineItem[] }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const color = (s: AutomationTimelineItem["status"]) =>
    s === "done" ? t.str : s === "failed" ? t.error : s === "running" ? t.accent : t.dim
  const glyph = (s: AutomationTimelineItem["status"]) =>
    s === "done" ? "✓" : s === "failed" ? "✗" : s === "running" ? "▶" : s === "waiting" ? "⋯" : "•"
  return (
    <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 6 }}>
      {items.map((it) => (
        <div
          key={it.id}
          style={{ display: "flex", gap: 7, fontSize: 10.5, lineHeight: 1.5, padding: "2px 0" }}
        >
          <span style={{ flexShrink: 0, color: color(it.status) }}>{glyph(it.status)}</span>
          <span style={{ color: t.dim }}>
            {it.label}
            {it.detail ? ` — ${it.detail}` : ""}
          </span>
        </div>
      ))}
    </div>
  )
}

function ActiveMission({ run }: { run: AutomationRun }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const pct = typeof run.confidence === "number" ? Math.round(run.confidence * 100) : null
  const progress = run.step && run.maxSteps ? Math.min(1, run.step / run.maxSteps) : null
  const meta = [
    run.step && run.maxSteps ? `step ${run.step}/${run.maxSteps}` : null,
    pct !== null ? `${pct}%` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <div style={{ background: t.accentD, border: `1px solid ${t.borderHi}`, borderRadius: 8, padding: "9px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: t.accent }}>{run.owner.label}</span>
        {meta && <span style={{ fontSize: 9.5, color: t.dim }}>{meta}</span>}
      </div>
      <div style={{ fontSize: 10, color: t.text, marginTop: 3 }}>{run.currentStep || run.task}</div>
      {progress !== null && (
        <div style={{ height: 3, borderRadius: 2, background: t.border, marginTop: 7, overflow: "hidden" }}>
          <div
            style={{ height: "100%", width: `${progress * 100}%`, background: t.accent, borderRadius: 2, transition: "width .3s" }}
          />
        </div>
      )}
      {run.timeline.length > 0 && <Timeline items={run.timeline} />}
    </div>
  )
}

function RunRow({ run }: { run: AutomationRun }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const replay = useYomiStore((s) => s.replayAutomation)
  const done = run.state === "completed"
  const failed = run.state === "failed"
  const statusColor = done ? t.str : failed ? t.error : t.dim
  const statusText = done ? "done" : failed ? "failed" : run.state
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        fontSize: 10,
        padding: "7px 9px",
        borderRadius: 6,
        background: t.chipBgCold,
        border: `1px solid ${t.chipBorderCold}`,
        marginTop: 5,
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: t.chipTextCold,
        }}
      >
        {run.task}
      </span>
      <span style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <span style={{ color: statusColor }}>
          {runGlyph(run.state)} {statusText}
        </span>
        {run.replayId && (done || failed) && (
          <button
            onClick={() => replay(run.replayId!)}
            style={{
              fontFamily: UI_FONT,
              fontSize: 9,
              color: t.hambColor,
              background: t.hambBg,
              border: `1px solid ${t.hambBorder}`,
              borderRadius: 5,
              padding: "1px 6px",
            }}
          >
            ↺ replay
          </button>
        )}
      </span>
    </div>
  )
}

export function MissionControl() {
  const { theme: t } = React.useContext(ThemeCtx)
  const open = useYomiStore((s) => s.missionsOpen)
  const runs = useYomiStore((s) => s.automationRuns)
  const activeId = useYomiStore((s) => s.activeAutomationRunId)
  const setOpen = useYomiStore((s) => s.setMissionsOpen)

  const active = runs.find((r) => r.id === activeId) ?? null
  const recent = runs.filter((r) => r.id !== active?.id)

  const sectionLabel = (text: string) => (
    <div
      style={{
        fontSize: 8.5,
        letterSpacing: "0.14em",
        fontWeight: 700,
        color: t.sectionLabel,
        margin: "10px 0 6px",
      }}
    >
      {text}
    </div>
  )

  return (
    <AnimatePresence>
      {open && runs.length > 0 && (
        <motion.div
          key="mission-control"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className="yomi-hit-area no-drag"
          style={{ marginTop: 8, width: PANEL_WIDTH, maxWidth: "calc(100vw - 40px)", flexShrink: 0 }}
        >
          <div
            style={{
              background: glassBar(t.menuBg),
              backdropFilter: "blur(28px) saturate(160%)",
              WebkitBackdropFilter: "blur(28px) saturate(160%)",
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              boxShadow: t.appShadow,
              overflow: "hidden",
              maxHeight: 460,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "9px 12px",
                borderBottom: `1px solid ${t.menuSep}`,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: UI_FONT,
                  color: t.text,
                  letterSpacing: "0.02em",
                }}
              >
                Mission Control
              </span>
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: t.dim, fontSize: 13, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "10px 12px 12px", overflowY: "auto", fontFamily: UI_FONT }}>
              <ApprovalCard />
              {active && (
                <>
                  {sectionLabel("ACTIVE MISSION")}
                  <ActiveMission run={active} />
                </>
              )}
              {recent.length > 0 && (
                <>
                  {sectionLabel("RECENT")}
                  {recent.map((r) => (
                    <RunRow key={r.id} run={r} />
                  ))}
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `tsc --noEmit`
Expected: PASS. (If `Theme` fields referenced here don't exist, fix the field name against `theme.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/mission/MissionControl.tsx
git commit -m "feat: mission control panel component"
```

---

## Task 4: Wire the panel into the app shell

Add the `◆ Missions` toolbar button (shown only when runs exist) and render `<MissionControl/>` under `<Notch/>`.

**Files:**
- Modify: `apps/desktop/src/renderer/app.tsx`

- [ ] **Step 1: Import the component**

At the top of `app.tsx`, add:

```tsx
import { MissionControl } from "./mission/MissionControl"
```

- [ ] **Step 2: Read missions state in `Toolbar`**

In `function Toolbar(...)`, change the store hook line:

```tsx
  const { ttsEnabled, toggleTts, pendingAct, clearPendingAct } = useYomiStore()
```

to also pull missions state:

```tsx
  const { ttsEnabled, toggleTts, pendingAct, clearPendingAct } = useYomiStore()
  const automationRuns = useYomiStore((s) => s.automationRuns)
  const missionsOpen = useYomiStore((s) => s.missionsOpen)
  const toggleMissions = useYomiStore((s) => s.toggleMissions)
```

- [ ] **Step 3: Add the Missions button to the toolbar's right controls**

In `Toolbar`, inside the right-controls `<div className="no-drag">` (the one starting around the voice-mode button), add this as the FIRST child so it sits left of the other controls:

```tsx
          {/* Missions — opens Mission Control; only when automations exist */}
          {automationRuns.length > 0 && (
            <button
              onClick={toggleMissions}
              title="Mission Control"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontFamily: UI_FONT,
                fontSize: 11,
                fontWeight: 500,
                color: missionsOpen ? t.hambColorActive : t.hambColor,
                background: missionsOpen ? t.hambBgActive : t.hambBg,
                border: `1px solid ${missionsOpen ? t.hambBorderActive : t.hambBorder}`,
                borderRadius: 7,
                padding: "3px 8px",
              }}
            >
              <span style={{ fontSize: 9 }}>◆</span> Missions · {automationRuns.length}
            </button>
          )}
```

- [ ] **Step 4: Render the panel under the notch**

In the authenticated return of `App`, immediately AFTER the `<Notch state={hotkeyState} voiceTurnBusy={voiceTurnBusy} />` line, add:

```tsx
      {/* Mission Control — drops under the notch when Missions is toggled */}
      <MissionControl />
```

- [ ] **Step 5: Typecheck**

Run: `tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `bun run build:ci`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/app.tsx
git commit -m "feat: wire mission control into toolbar and overlay"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Lint, typecheck, build, test (desktop)**

From `apps/desktop/`:

```bash
bun run lint
tsc --noEmit
bun run build:ci
bun test --pass-with-no-tests
```

Expected: all pass; `store.test.ts` shows 6 passing tests.

- [ ] **Step 2: Repo-wide gates**

From the repo root:

```bash
bun run lint && bun run typecheck && bun run build:ci && bun run test
```

Expected: all green.

- [ ] **Step 3: Manual verification (sidecar running, plan `max`)**

Follow Spec 18's checklist with the new UI:

1. Run an automation ("play lofi on spotify"). A `◆ Missions · N` button appears on the toolbar.
2. Click it → panel drops under the notch showing the Spotify Agent active mission with a live timeline and progress.
3. Repeat the task → the "prior experience" timeline entry appears in the active mission.
4. Trigger a dangerous action ("send a whatsapp to Alex…") → the panel auto-opens with an Approve/Deny card; Approve → action proceeds; the card clears.
5. After a run completes, it moves to RECENT with a working ↺ replay button.
6. Closing the panel (✕) leaves the run running; the notch glance still shows status.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: mission control verification fixes"
```

(Skip if nothing changed.)

---

## Self-Review Notes

- **Spec coverage:** Surface A drop-down (Task 4) ✓; notch unchanged (no notch edits) ✓; active mission timeline + progress + knowledge hint via styled timeline (Task 3) ✓; recent history + replay (Task 3) ✓; approval card via wired `confirmAct` (Task 3) ✓; auto-open on pending approval (Task 2) ✓; `theme.tsx` isolation (Task 1) ✓; store tests (Task 2) ✓; no new SSE/sidecar ✓.
- **Known minor redundancy:** the existing toolbar approval prompt (`app.tsx` ~line 2904) still renders alongside the panel's `ApprovalCard`; both act on the same `pendingAct` and both clear it, so there is no conflict. Consolidating to a single approval surface is deferred follow-up, not part of this plan.
- **Type consistency:** `missionsOpen`, `toggleMissions`, `setMissionsOpen` are named identically across store, tests, and component. `AutomationRun`/`AutomationTimelineItem` fields used in the component (`owner.label`, `task`, `state`, `step`, `maxSteps`, `confidence`, `currentStep`, `timeline`, `replayId`) match `packages/shared/src/index.ts`.
