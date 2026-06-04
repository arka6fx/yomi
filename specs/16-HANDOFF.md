# Spec 16 — Windows App Automation — HANDOFF

Continuation handoff for the UIA app-automation work. Everything below is **implemented in the
working tree (uncommitted)** and verified green: **6/6 typecheck, 137 sidecar tests pass, 0 lint
errors**. Companion docs: `specs/16-windows-app-automation.md` (design spec).

---

## Goal
Let Yomi drive native Windows desktop apps from voice/type commands via **Microsoft UI Automation
(UIA)**, with a vision/coordinate fallback. The agent (Max tier) gains tools to open apps, read the
control tree, and click/type/press keys.

## Architecture
```
apps/desktop (Electron) ── spawns ──► apps/sidecar (Bun) ── JSON-RPC over stdio ──► apps/uia-helper (C#/.NET 8, FlaUI)
```
A separate **C# helper** is used because **Bun (JavaScriptCore) cannot reliably load native UIA node
addons**. The helper speaks line-delimited JSON-RPC over stdin/stdout.

---

## Environment already set up on this machine (NOT in repo — assume present)
- **.NET 8 SDK** via `winget install Microsoft.DotNet.SDK.8`. `dotnet` at `C:\Program Files\dotnet\dotnet.exe`
  (may not be on PATH in fresh shells).
- NuGet source added: `dotnet nuget add source https://api.nuget.org/v3/index.json --name nuget.org`.
- Bun at `C:\Users\arkag\.bun\bin`.

---

## NEW app: `apps/uia-helper/` (C# / FlaUI.UIA3 4.0.0, net8.0-windows)
Files: `UiaHelper.csproj`, `Program.cs`, `README.md`, `.gitignore`, `package.json`
(`@yomi/uia-helper`, workspace member, `build` = `dotnet publish`).

JSON-RPC methods (`{"id":N,"method":"...","params":{...}}` → `{"id":N,"result":{...}}`):

| method | params | notes |
|---|---|---|
| `ping` | — | health |
| `get_ui_tree` | `{maxNodes?, maxDepth?, hwnd?}` | flattened **control view**; `hwnd` (int64) targets a specific window instead of `GetForegroundWindow()` — added to fix focus-steal on reads |
| `invoke_element` | `{ref}` | InvokePattern, falls back to `el.Click()` |
| `click_element` | `{ref}` | **real mouse click** `el.Click()` — for UWP/WebView apps that ignore InvokePattern |
| `set_value` | `{ref,text}` | ValuePattern.SetValue (often doesn't trigger app handlers) |
| `type_text` | `{text, ref?}` | **real keystrokes** `Keyboard.Type` (focuses ref first) — for search boxes/composers |
| `toggle_element` | `{ref}` | TogglePattern |
| `press_key` | `{keys}` | chords: `"Enter"`, `"Ctrl+S"`, `"Ctrl+Shift+X"`. **Alt is `VirtualKeyShort.ALT`, not `MENU`** |
| `click_point` | `{x,y,button?}` | coordinate fallback |

Element fields: `{ref ("w<win>e<el>"), role, name, automationId, rect{x,y,width,height} (physical
px), patterns[], enabled, value}`. **Refs are valid only within the latest snapshot.**

Build: `dotnet publish -c Release -r win-x64 -p:PublishSingleFile=true --self-contained -o dist`
→ single ~147 MB `dist/uia-helper.exe` (compression follow-up: `-p:EnableCompressionInSingleFile=true`).

---

## Sidecar changes (`apps/sidecar/`)
- **NEW `src/uia/client.ts`** — singleton `uia`; spawns helper (`Bun.spawn`), JSON-RPC framing + id
  correlation + 5s timeout + respawn; caches last snapshot (`getElement(ref)`, `lastWindow`,
  `pendingPoint`). Helper path = `process.env.YOMI_UIA_HELPER` (prod) or dev fallback
  `apps/uia-helper/dist/uia-helper.exe`.
- **NEW `src/uia/safety.ts`** — `isBlockedApp()` (password managers/banking), `classifyRisk(kind, el)`
  (delete/send/pay/etc + password fields), `confirmRisky`, `registerConfirmer`. + `safety.test.ts`.
- **NEW `src/uia/act-bus.ts`** — cross-process confirm: `requestConfirmation()` emits `act_proposed`
  on the live agent SSE stream and awaits POST `/act/confirm`; `setActEmitter`, `resolveConfirmation`,
  `emitActResult`. + `act-bus.test.ts`. (14 UIA tests total.)
- **`src/tools/system.ts`** — tools: `get_ui_tree`, `invoke_element`, `click_element`, `set_value`,
  `type_text`, `toggle_element`, `press_key`, `launch_app`; `point_cursor`/`click` via helper.
  Acting tools go through `guardedAct` (blocklist → risk → confirm → execute → `act_result`).
  `launch_app` spawns `powershell Get-StartApps` → `Start-Process shell:AppsFolder\<AppID>` (sanitizes name).
- **`src/harness/tools.ts`** — registered all new tools in `AGENT_TOOLS` + `TOOL_DESCRIPTIONS`.
- **`src/harness/prompt.ts`** — `<app_automation>` block (launch→get_ui_tree→act; prefer Send button
  over Enter; use `click_element`/`type_text` for UWP apps). **The prompt is a template literal — no
  backticks inside it.**
- **`src/pipeline/agent.ts`** — `agentPipeline(req, {emit})` wires SSE writer to act-bus via
  `setActEmitter`, in try/finally.
- **`src/index.ts`** — `/query` + `/query/agent` pass `emit`; added `POST /act/confirm` + `/act/*` auth.

## Shared (`packages/shared/src/index.ts`)
Added `UiaElement`, `UiaSnapshot`, `UiaAction`, and SSE events `act_proposed`
(`{id, action, label, risky, rect?}`) + `act_result`.

## Desktop (`apps/desktop/`)
- `src/main/sidecar.ts` — `uiaHelperPath()` + passes `YOMI_UIA_HELPER` env when spawning sidecar.
- `src/main/ipc.ts` — `actModeActive`, `yomi:act-mode` + `yomi:act-confirm` handlers; Act-on routes
  automation-verb queries to `/query/agent` (`shouldUseAgent`); seeds a `transcript` event; act loop.
- `src/renderer/store.ts` — `actEnabled`, `pendingAct`, `toggleActMode`, `clearPendingAct`; handles
  `agent_text`/`act_proposed`/`act_result`.
- `src/renderer/app.tsx` — **Act** toolbar toggle + red **Yes/No confirm** prompt for risky actions.
- `src/preload/index.ts` + `global.d.ts` — `setActMode`, `confirmAct`.
- `electron-builder.yml` — stages helper into `resources/uia/`. `turbo.json` — `@yomi/desktop#build`
  depends on `@yomi/uia-helper#build` (CI graph untouched; `build:ci`/typecheck/test stay dotnet-free).

---

## LIVE test results (driven directly via helper from PowerShell)
- ✅ **Calculator** — `invoke_element`/`click_element`/`press_key` all proven (`8−3=5`, typed `99`, `6`+`3`→`63`).
- ✅ **Spotify (WebView2 UWP)** — **full success**: `launch_app` → `Ctrl+L` → `type_text "Savera
  Anubha Bajaj"` → `Enter` → `get_ui_tree` (tree expands 26→~800 nodes once content renders) →
  `click_element` top-result Play → **"Now playing: Savera by Iqlipse Nova, Anubha Bajaj"**.
- ⚠️ **Telegram = Unigram (UWP)** — composer is an `Edit` named **"Message"** (only appears once the
  chat fully renders). Sending into an *already-open* chat works; **switching chats fails** (search-
  result clicks/keyboard `Down+Enter`/`Ctrl+0` don't open chats). Header verification (chat title in
  the right-panel header band) reliably blocks wrong-recipient sends.
- ❌ **WhatsApp (UWP)** — hardest: contact list ignores ALL synthetic clicks/keyboard; can't open
  chats. Reading/typing work; navigation doesn't.

## ⚠️ CRITICAL GOTCHA (explains most "failures")
**Testing from inside the Cursor IDE, Cursor steals foreground/keyboard focus** from PowerShell test
scripts. Worked around with `SetForegroundWindow`+`AttachThreadInput` force-foreground and the `hwnd`
param on `get_ui_tree` (reliable reads). **BUT keystrokes (`type_text`/`press_key`) use `SendInput`,
which follows keyboard focus — Cursor reclaims it, so keystroke sends are unreliable from the IDE
harness.** This is a **test-environment artifact only** — the real Electron app spawns the helper
detached and the target app keeps focus. The Spotify success proves the system works when focus holds.

## Known issues / TODO for continuation
1. **Verify in the real app** (`bun run dev` → Act mode) where focus isn't contested — primary next step.
2. **Voice confirm** — currently a Yes/No button MVP; the act-bus/confirm protocol is wired, voice
   yes/no interpreter is the follow-up.
3. **Overlay highlight** of `act_proposed.rect` — deferred (HiDPI calibration: UIA = physical px,
   Electron = DIP; this machine is 100% DPI).
4. **UWP chat-switching** (WhatsApp/Unigram) — synthetic clicks don't open chats; needs vision-click
   pipeline or `PostMessage`-based input. Keep the **header-verification** safety pattern (read the
   right-panel chat title and confirm it matches the intended recipient *before* typing/sending).
   Note: window geometry varies — compute the header region relative to the window rect, not hardcoded x.
5. Helper exe is 147 MB — try single-file compression.
6. Windows-only; tool contracts are OS-agnostic for a future macOS AXUIElement helper.

## Build / test commands
```bash
# helper
dotnet publish apps/uia-helper/UiaHelper.csproj -c Release -r win-x64 -p:PublishSingleFile=true --self-contained -o apps/uia-helper/dist
# repo (root, bun on PATH)
bun run typecheck   # 6/6
bun run test        # 137 pass
bun run lint        # 0 errors
# helper standalone:  '{"id":1,"method":"ping"}' | apps/uia-helper/dist/uia-helper.exe
# sidecar e2e: set YOMI_UIA_HELPER to the dist exe; YOMI_ACT_AUTOCONFIRM=true bypasses risky confirm in tests
```

## Files changed (git diff --stat, automation-relevant)
```
apps/uia-helper/**                         (new C# project)
apps/sidecar/src/uia/{client,safety,act-bus}.ts (+ *.test.ts)   (new)
apps/sidecar/src/tools/system.ts           (+223 lines: all UIA tools)
apps/sidecar/src/harness/{tools,prompt}.ts
apps/sidecar/src/pipeline/agent.ts
apps/sidecar/src/index.ts                  (/act/confirm, emit wiring)
packages/shared/src/index.ts               (Uia* types + act_* events)
apps/desktop/src/main/{sidecar,ipc}.ts
apps/desktop/src/renderer/{store.ts,app.tsx,global.d.ts}
apps/desktop/src/preload/index.ts
apps/desktop/electron-builder.yml
turbo.json, package.json
```
(Note: `apps/landing/**`, `packages/db/src/schema.ts`, `.env.example`, mac entitlements deletion in
the diff are **pre-existing** changes from before this work — not part of Spec 16.)
