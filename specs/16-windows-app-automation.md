# Spec 16 - Windows App Automation via Accessibility APIs

## Purpose

Define how Yomi acts on native Windows desktop apps from voice/type commands, the reliable way:
through **Microsoft UI Automation (UIA)** — the same accessibility tree screen readers consume.

Today Yomi can *see* the screen and *point* at things (Spec 15: vision model emits `[POINT:x,y]`,
the desktop draws a guide cursor), but it cannot *act* — `point_cursor` and `click` in
`apps/sidecar/src/tools/system.ts` are Windows stubs returning "not implemented". This spec turns
guidance into action.

UIA is preferred over raw coordinate clicking because it exposes each control as a semantic object
(control type, name, bounding rect, `AutomationId`, supported *patterns* like Invoke/Value/Toggle).
The agent picks a control **by meaning** ("the Save button") and invokes it via its pattern,
instead of guessing pixels that break on layout/DPI/scroll changes. Vision + coordinate clicking is
kept as a **fallback** for apps with no usable UIA tree (some Electron/Qt/games/custom-drawn UIs).

This feature lives on the **agent path** (Max tier per AGENTS.md). The fast/guide path (Spec 15)
stays guidance-only except that the accessibility tree becomes an optional precision source for
`[POINT]` targeting.

## Locked Decisions

1. **Targeting:** Hybrid — UIA accessibility tree is primary; vision/coordinate pointing is the
   fallback when no usable tree exists.
2. **Action model:** Opt-in **Act mode**. Safe actions (click a button, type in a field) run
   automatically; destructive/irreversible ones (delete, send, pay, submit, discard,
   close-without-save) require **voice confirmation** first.
3. **UIA runtime:** A small self-contained **C# / FlaUI helper process** speaking JSON-RPC over
   stdio to the Bun sidecar. Bun cannot reliably load native node-gyp/V8 addons; an out-of-process
   .NET helper sidesteps that and gives robust UIA access. The element-ref scheme follows
   FlaUI-MCP's stable `w<window>e<element>` pattern.

## Architecture

```
apps/desktop (Electron)
  capture.ts ── screenshot ──┐
                             ▼
apps/sidecar (Bun)   fast/agent pipeline + LLM
  │  tools: get_ui_tree, invoke_element, set_value, toggle_element, point_cursor/click (fallback)
  │  ▲ JSON-RPC (line-delimited) over stdio
  ▼
apps/uia-helper (NEW, C# .NET, FlaUI)   ← single self-contained .exe in resources/uia/
  enumerate focused-window control view → snapshot {ref, role, name, rect, patterns, automationId}
  act on a ref → InvokePattern / ValuePattern / TogglePattern / coordinate fallback
```

The Bun sidecar spawns and supervises the helper as a long-lived child process, mirroring how
`apps/desktop/src/main/sidecar.ts` (`SidecarManager`) spawns the sidecar today: spawn → handshake
(`ping`) → restart on crash.

## New App: `apps/uia-helper/` (C# / .NET, FlaUI)

Self-contained single-file `dotnet publish` (`win-x64`, `--self-contained`, `PublishSingleFile`)
so no .NET runtime install is required on the user's machine. References `FlaUI.Core` + `FlaUI.UIA3`.

JSON-RPC methods (line-delimited JSON over stdin/stdout):

```text
ping()                                   -> { ok: true }            # handshake/health
get_ui_tree({ scope?, maxDepth?, maxNodes? })  -> UiaSnapshot
invoke_element({ ref })                  -> { ok, role, name }      # InvokePattern.Invoke()
set_value({ ref, text })                 -> { ok, before, after }   # ValuePattern.SetValue() + focus; keystroke fallback
toggle_element({ ref })                  -> { ok, before, after }   # TogglePattern
click_point({ x, y, button })            -> { ok }                  # coordinate fallback (FlaUI Mouse)
focus_window({ ... })                    -> { ok }
```

`get_ui_tree` returns the **control view** (`IsControlElement = true`) of the target window
(`scope` defaults to the focused/foreground window), flattened to a node list. Node count and depth
are capped (e.g. `maxNodes` ~400) to keep latency low and the LLM prompt small. `ref` is a stable
per-snapshot id mapped server-side to the live `AutomationElement`. Rects are physical screen pixels
so the desktop can reuse existing coordinate mapping.

Acting methods return enough context (`role`, `name`, `before`/`after`) for the sidecar to describe
what happened via TTS.

## Shared Contracts

`packages/shared/src/index.ts` owns the public shapes:

```ts
interface UiaElement {
  ref: string
  role: string                 // control type: "Button", "Edit", "MenuItem", ...
  name: string
  automationId?: string
  rect: { x: number; y: number; width: number; height: number }  // physical screen px
  patterns: string[]           // ["Invoke","Value","Toggle",...]
  enabled: boolean
  value?: string
}

interface UiaSnapshot { window: string; elements: UiaElement[] }

type UiaAction =
  | { kind: "invoke"; ref: string }
  | { kind: "set_value"; ref: string; text: string }
  | { kind: "toggle"; ref: string }
  | { kind: "click_point"; x: number; y: number; button?: "left" | "right" | "middle" }
```

`SseEvent` gains act-loop variants so the renderer can show/confirm actions:

```ts
| { type: "act_proposed"; action: UiaAction; label: string; risky: boolean }
| { type: "act_result"; ok: boolean; label: string; detail?: string }
```

`UiaElement.rect` reuses the physical-screen-pixel convention so
`apps/desktop/src/main/spatial-mapping.ts` and `guide-overlay.ts` can highlight a targeted element
with no new coordinate math.

## Sidecar Behavior

### UIA Client

`apps/sidecar/src/uia/client.ts` (new) spawns the helper via `Bun.spawn`, frames JSON-RPC over
stdio, correlates requests/responses by id, and handles timeout + restart-on-crash. Helper path
resolves like `sidecarBinPath()` in `apps/desktop/src/main/sidecar.ts` (packaged → `resourcesPath`,
dev → `apps/uia-helper/dist`). The client is a lazily-started singleton, booted on first UIA call.

### Tools

`apps/sidecar/src/tools/system.ts` is extended:

- `get_ui_tree` (new) — calls the helper, returns the compact control list to the LLM. This is the
  semantic equivalent of `look_at_screen` for *acting*.
- `invoke_element` / `set_value` / `toggle_element` (new) — take a `ref` from the latest snapshot.
  Every acting call routes through the safety guard before reaching the helper.
- `point_cursor` / `click` — keep the tool surface, but implement the Windows path as a thin wrapper
  over the helper's `click_point` (coordinate fallback) instead of returning the stub error.
- `look_at_screen` and `bash` are unchanged.

New tools are registered into the agent loop's tool set, and `get_ui_tree` is exposed to the
fast/guide pipeline as an optional precision source for `[POINT]` targeting.

### Safety Guard (Act mode)

`apps/sidecar/src/uia/safety.ts` (new):

- Marks an action `risky` when the target element's `name`/`role` matches destructive verbs
  (delete, remove, send, pay, submit, buy, discard, close without save, format, uninstall) or when
  `set_value` targets a password field.
- Risky actions emit `act_proposed` and **pause** until the desktop returns a confirmation —
  mirroring the `PreToolUse` hook concept in AGENTS.md. Confirmation reuses the guide loop's voice
  capture (`guide-audio.ts`) to get a spoken "yes/do it".
- Honors the per-app blocklist privacy rule: never enumerate or act on password managers or banking
  apps — the foreground window is checked against the blocklist before `get_ui_tree`.
- Act mode is opt-in: gated behind a toolbar toggle and the Max plan, default off.

## Desktop Behavior

- `apps/desktop/src/main/guide-overlay.ts` highlights the element Yomi is about to act on (box from
  `UiaElement.rect`), giving a visible, cancelable beat — satisfying "visible status, no silent
  action."
- A new **Act** toolbar toggle sits alongside the Point/Voice/Type controls.
- `apps/desktop/src/main/ipc.ts` extends the existing guide loop into an act loop: on `act_proposed`
  it flashes the highlight and (if `risky`) starts the confirm listen, then sends confirm/cancel back
  to the sidecar; on `act_result` it shows a status pill + TTS summary.
- Element rects map via existing `spatial-mapping.ts` (`mapGuideElementToScreen`) — no new math.

## Patterns Reused

- Process spawn/health/restart: `SidecarManager` in `apps/desktop/src/main/sidecar.ts`.
- Binary path resolution: `sidecarBinPath()` → new `uiaHelperPath()`.
- Coordinate mapping + overlay highlight: `spatial-mapping.ts` + `guide-overlay.ts`.
- Voice confirm capture: `guide-audio.ts` RMS auto-listen from the navigation loop.
- Tool definition style: the `ai` SDK `tool()/jsonSchema()` pattern already in `system.ts`.

## Build & Packaging

- Add `apps/uia-helper` to the root `package.json` / Turborepo so `bun run build` also publishes the
  helper.
- Copy the published `.exe` into desktop `extraResources` (`apps/desktop/electron-builder.yml`) under
  `resources/uia/uia-helper.exe`, the same way the sidecar binary is staged.

## Limitations

- UIA-blind apps (some Electron/Qt/games/custom-drawn UIs) fall back to vision `[POINT]` + coordinate
  `click_point`, which inherits Spec 15's coordinate-drift caveats.
- Element refs are per-snapshot. If an action fails with "element no longer available", re-fetch the
  tree rather than caching refs across turns.
- Windows-only. The tool contracts are OS-agnostic so a future macOS `AXUIElement` helper can
  implement the same JSON-RPC surface.

## Tests

- `apps/sidecar/src/uia/safety.test.ts` — risky-action classification, blocklist refusal,
  confirmation gating.
- `apps/sidecar/src/uia/client.test.ts` — JSON-RPC framing/correlation against a mock helper;
  restart-on-crash.
- `apps/sidecar/src/tools/system.test.ts` — `get_ui_tree`/`invoke_element`/`set_value` route through
  the guard; `point_cursor`/`click` hit the coordinate fallback.
- Helper smoke test: drive `get_ui_tree` + `invoke_element` against Notepad/Calc.

## Verification

CI-relevant commands must pass:

```bash
bun run lint
bun run build:ci
bun run typecheck
bun run test
```

End-to-end manual checks:

1. **Helper standalone:** pipe `{"id":1,"method":"get_ui_tree"}` to `uia-helper.exe` → returns
   Notepad's/Calc's control list with names, rects, patterns. `invoke_element` a button ref → app
   reacts.
2. **Agent path:** voice "open the File menu and click Save" against Notepad → `get_ui_tree` then
   `invoke_element` fire and the menu opens/saves.
3. **Fallback:** target a custom-drawn app with no useful tree → degrades to vision `[POINT]` +
   `click_point`.
4. **Safety:** trigger a destructive control → `act_proposed` with `risky:true`, nothing happens
   until voice "yes"; a blocklisted (password manager) window is refused before enumeration.
5. **Desktop UX:** Act toggle on → overlay highlights target, action runs, TTS confirms; toggle off
   → guidance only.
6. **Latency:** `get_ui_tree` round-trip stays within the fast-path budget (~300 ms) so
   voice→action feels live.

## Implementation Order

1. `apps/uia-helper/` C# FlaUI helper + JSON-RPC stdio surface; publish wiring.
2. `packages/shared/src/index.ts` contracts (`UiaElement`, `UiaSnapshot`, `UiaAction`, act events).
3. `apps/sidecar/src/uia/client.ts` spawn + framing; `safety.ts` guard.
4. `apps/sidecar/src/tools/system.ts` new tools + coordinate fallback for `point_cursor`/`click`.
5. `apps/desktop` Act toggle, overlay highlight, act-loop + confirm round-trip in `ipc.ts`.
6. Packaging in `electron-builder.yml` + root `package.json`; tests; verification.

## Files

- `apps/uia-helper/**` (new C# project)
- `apps/sidecar/src/uia/client.ts` (new)
- `apps/sidecar/src/uia/safety.ts` (new)
- `apps/sidecar/src/tools/system.ts`
- `packages/shared/src/index.ts`
- `apps/desktop/src/main/guide-overlay.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/electron-builder.yml`
- root `package.json` (Turborepo build wiring)

## Future Work

- macOS parity via an `AXUIElement` helper implementing the same JSON-RPC surface.
- Cache + diff snapshots across a multi-step task to reduce repeated `get_ui_tree` cost.
- Scroll/expand handling for controls below the fold (ScrollPattern/ExpandCollapsePattern).
- Usage metering of `agent_run` for Act-mode sessions per Spec 13 pricing.
