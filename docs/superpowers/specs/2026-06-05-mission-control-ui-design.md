# Mission Control UI — Design

Date: 2026-06-05
Branch: `feat/provider-routed-subagents`
Relates to: `specs/18-automation-orchestration.md` ("Future Work → Mission Control UI")

## Purpose

Spec 18 turned the agent path into a transparent orchestrator that streams every
automation's progress (`automation_*` SSE) into the desktop Zustand store. That
data currently surfaces **only** in the notch as a one-line glance. This design
adds **Mission Control**: a drop-down panel that hangs under the notch and gives
the user the full picture of what Yomi is doing — the active mission's live
timeline, recent run history with replay, and inline approval of pending
actions.

Scope is **renderer-only**. No new SSE events and no new sidecar code: every
piece of data and every IPC action this panel needs is already wired.

## Non-Goals (v1)

- Cancel/stop a running mission (needs a new IPC + sidecar endpoint — deferred).
- Full-screen "dashboard" mode (the companion-overlay variant — deferred; this
  panel is designed so an "expand" affordance can be added later).
- Editing a mission plan before it runs.
- Mission/workspace persistence beyond what the store already holds.

## Locked Decisions

1. **Surface = drop-down panel.** A `◆ Missions · N` toolbar button toggles a
   panel that drops under the notch, reusing the chat-card slot, the
   `yomi:resize` auto-height flow, and the `set-hit-regions` passthrough. Not a
   separate window; not full-screen.
2. **The notch stays.** It remains the always-on ambient pill: voice/state
   (Listening / Processing / Speaking) **and** the existing live automation
   one-liner. The panel is purely additive — when a run is live with the panel
   open, the user sees both the notch glance and the rich panel.
3. **v1 = transparency + approvals.** Read-only timeline/history/replay **plus**
   an Approve/Deny card backed by the already-wired act-bus confirm. No
   cancel button in v1.
4. **No backend changes.** Data comes from existing store fields; actions reuse
   existing IPC (`confirmAct`, `replayAutomation`).
5. **Isolate in its own module.** New code lives in
   `renderer/mission/MissionControl.tsx`; shared theme primitives are extracted
   into `renderer/theme.tsx` so the panel doesn't bloat the 4,433-line
   `app.tsx`.

## Architecture

```
SSE automation_* / act_proposed  ──►  store.handleSseEvent (existing)
                                         store: automationRuns[], activeAutomationRunId, pendingAct
                                         store: missionsOpen (NEW)
                                              │
toolbar ◆ Missions button ──toggle──►  missionsOpen
                                              │
                                       <MissionControl> (NEW, under <Notch/>)
                                         ├─ <ApprovalCard>  → confirmAct(id, approved)  (wired)
                                         ├─ <ActiveMission> (timeline + progress + knowledge hint)
                                         └─ <RunRow>×n      → replayAutomation(replayId) (wired)
```

### Store changes (`renderer/store.ts`)

Add to `YomiState`:

- `missionsOpen: boolean` (default `false`).
- `toggleMissions: () => void`.
- `setMissionsOpen: (open: boolean) => void`.

Behavior:

- **Auto-open on a pending approval.** Whenever `pendingAct` becomes set (the
  existing `act_proposed` risky case), set `missionsOpen = true` so the approval
  card is visible. Also auto-open on `automation_waiting` with
  `risk === "dangerous"` (→ `needs_approval`) for graph-level waits that don't
  carry a per-tool `pendingAct`.
- `pendingAct` itself is **unchanged** — already set by `act_proposed` (risky)
  and cleared by `act_result`. The Approval card reads it directly.
- No other store changes; `automationRuns` is already capped at 12 and
  `timeline` at 40.

### Components (`renderer/mission/MissionControl.tsx`)

- **`MissionControl({ open })`** — the panel container. Returns `null` when
  `!open`. Renders, in order, the conditional `ApprovalCard`, the
  `ActiveMission` (if a live/recent run exists), and a `Recent` list of the
  remaining runs. Wrapped in the same `AnimatePresence` drop animation as the
  chat card; tagged `no-drag` / `yomi-hit-area` so it participates in mouse
  passthrough.
- **`ApprovalCard`** — rendered only when `pendingAct` is set. Shows
  `pendingAct.label` + Approve/Deny buttons calling
  `confirmAct(pendingAct.id, true|false)`. Disappears when `pendingAct` clears.
- **`ActiveMission({ run })`** — agent label (`run.owner.label`), `run.task`,
  step progress (`run.step`/`run.maxSteps`, `run.confidence`), the `timeline[]`
  rendered with per-`status` styling, and any "prior experience" knowledge entry
  (already arrives as a timeline item — styled as a hint).
- **`RunRow({ run })`** — compact history row: task + status glyph; a Replay
  button when `run.replayId` and state is `completed`/`failed`.
- **Empty state** — if there are runs but none active, the panel still opens to
  the Recent list. If `automationRuns` is empty the toolbar button is hidden, so
  the panel can't be opened empty.

### Toolbar button (`renderer/app.tsx`)

Small addition in `Toolbar`: when `automationRuns.length > 0`, show a
`◆ Missions · N` button (N = count) that calls `toggleMissions()`. Active/open
state reflected by a chevron + highlight. Hidden when there are no runs.

### Theme extraction (`renderer/theme.tsx`)

Move from `app.tsx` into a new `theme.tsx` (re-exported so existing imports keep
working):

- `Theme` type, the `THEMES` record, `ThemeCtx`, `ThemeProvider`.
- The primitives the panel needs: `UI_FONT`, `glassBar`, `translucentColor`.

`app.tsx` imports these from `theme.tsx`; `MissionControl.tsx` imports them too.
This is the only refactor — scoped to enabling clean isolation, not a rewrite.

## Data Flow

1. Sidecar emits `automation_*` / `act_proposed` over the existing SSE stream.
2. `store.handleSseEvent` updates `automationRuns`, `activeAutomationRunId`,
   `pendingAct` (all existing) and may set `missionsOpen` on a dangerous wait.
3. `Toolbar` shows the Missions button/count; user toggles `missionsOpen`.
4. `MissionControl` renders from the store. Approve/Deny → `confirmAct`; Replay →
   `replayAutomation`. Both IPC paths already exist
   (`yomi:act-confirm` → `/act/confirm`, `yomi:automation-replay` →
   `/automation/replay`).
5. Window height re-measures through the existing resize observer; hit-regions
   update so clicks land correctly and pass through elsewhere.

## Error / Edge Handling

- **Long timelines** — `ActiveMission` timeline scrolls inside a capped
  `maxHeight`; the panel itself has a `maxHeight` with internal scroll.
- **Run completes while open** — panel keeps showing it (moves Active → Recent
  via the store's existing state transitions); notch glance persists.
- **Approval resolves by voice** — `act_result` clears `pendingAct`; the card
  vanishes with no extra handling.
- **UI opacity** — panel honors the existing `yomi:opacity` setting via the
  shared translucency helpers.
- **Closing the panel** does not stop the run; reopening shows current state.
- **Resize race on `done`** — handled by the existing ResizeObserver-driven
  `yomi:resize`.

## Testing

- **Store unit tests** (`store` already testable): `toggleMissions` /
  `setMissionsOpen`; `automation_waiting` dangerous → `missionsOpen = true`;
  Missions count derives from `automationRuns.length`.
- **Components** are pure and prop-driven (state read via store selectors at the
  container); there is no renderer component-test harness in the repo today, so
  v1 does not add one. Manual verification follows Spec 18's checklist: run
  "play lofi on spotify", open the panel, confirm the live timeline, the
  prior-experience hint on a repeat, an approval card on a dangerous action, and
  Replay on a completed run.
- Existing gates must stay green: `bun run lint`, `bun run typecheck`,
  `bun run build:ci`, `bun run test`.

## Files

- `apps/desktop/src/renderer/mission/MissionControl.tsx` (new) — panel +
  subcomponents.
- `apps/desktop/src/renderer/theme.tsx` (new) — extracted theme primitives.
- `apps/desktop/src/renderer/store.ts` — `missionsOpen` + actions; auto-open on
  dangerous wait.
- `apps/desktop/src/renderer/app.tsx` — Missions toolbar button; render
  `<MissionControl>` under `<Notch>`; import theme from `theme.tsx`.
- `apps/desktop/src/renderer/store.test.ts` (new) — store unit tests.

## Future Work

- "Expand" affordance → full companion-overlay dashboard (Surface B/C).
- Cancel/pause a running mission (new IPC + sidecar endpoint).
- Per-provider health surfaced in the panel (`GET /automation/health`).
- Mission plan preview/edit before execution.
