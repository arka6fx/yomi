# Spec 03 - Desktop Shell

## Purpose

Define the Electron main process structure, platform adapters, capture
abstraction, sidecar lifecycle, and device-code auth. The shell is OS
integration only: no AI logic, memory retrieval, or prompt construction lives
here.

## Invariants

- The desktop app makes no direct LLM calls. Everything goes to the sidecar.
- Login happens in the system browser, never in an embedded Electron window.
- The sidecar must be healthy before any notch/tray status or Mission Control
  surface becomes interactive.
- Desktop automation is foreground-specific; no detached background agent
  surface or companion dock.
- Auth tokens are stored with Electron `safeStorage`.
- Local RAG is owned by the sidecar. The desktop does not expose file-upload RAG
  controls.

## Process Structure

```text
apps/desktop/src/
  main/
    index.ts          app lifecycle, tray/notch, windows, hotkeys
    sidecar.ts        sidecar spawn, health, restart
    capture.ts        desktopCapturer screenshot capture
    hotkey.ts         global shortcut registration
    ipc.ts            renderer <-> main <-> sidecar/backend bridge
    auth.ts           device-code auth and encrypted token storage
    guide-overlay.ts  transparent click-through visual guide overlay
    spatial-mapping.ts anchor guide elements to screen coordinates
  preload/
    index.ts          contextBridge API exposed to renderer
  renderer/
    app.tsx           notch/tray status + Mission Control UI
    mission/
      MissionControl.tsx  drop-down panel for automation timeline, approvals
    theme.tsx         system theme extraction (accent color, dark/light)
```

## Sidecar Lifecycle

The main process starts the sidecar in packaged mode and expects it to already
be running in `YOMI_DEV=true`.

```ts
class SidecarManager {
  readonly secret = crypto.randomUUID()
  readonly baseUrl = "http://127.0.0.1:3002"
}
```

Requests to the sidecar include `x-sidecar-secret`. Health is checked with
`GET /health`; repeated failures restart the process.

## Capture

Electron `desktopCapturer` runs in the main process. The renderer never imports
it.

```ts
const sources = await desktopCapturer.getSources({
  types: ["screen"],
  thumbnailSize: { width: 1920, height: 1080 },
})
```

Yomi windows call `setContentProtection(true)` before showing, so Yomi UI is
excluded from screenshots and screen shares.

## Windowing Policy

Yomi is a foreground-specific desktop automation app. The default surface is a small
tray/notch status pill that can show idle, listening, processing, speaking,
error, and automation states. Long-running work updates Mission Control for
details, approvals, cancellation, and results.

Do not create detached background runs or floating agent companions. Desktop
automation may foreground or focus the target app when needed, and should keep
progress in the normal Yomi surface plus Mission Control.

## Hotkeys

Default shortcuts:

| Shortcut     | State                  | Action                                |
| ------------ | ---------------------- | ------------------------------------- |
| `Ctrl+Space` | idle                   | Start voice recording                 |
| `Ctrl+Enter` | idle                   | Open text input                       |
| `Enter`      | listening              | Send voice query (triggers STT + LLM) |
| `Esc`        | listening / text-input | Cancel and return to idle             |
| `Ctrl+H`     | any                    | Show or hide Mission Control          |

`Ctrl+Space` only starts listening — it no longer toggles stop. `Enter` is the
submit key while recording; `Esc` cancels without submitting.

The notch/tray status menu exposes **Voice** and **Type** as on-screen
equivalents of `Ctrl+Space` and `Ctrl+Enter`. While listening, **Send (Enter)**
and **Stop (Esc)** controls are available from the active status surface.

## Fast Query Bridge

On submit, the desktop collects text or audio, captures a screenshot, reads
account state, and sends:

```ts
{
  text,
  audio_b64,
  screenshot_b64,
  mode: "answer",
  tts,
  plan,
  history
}
```

The response is an SSE stream from `/query/fast`; the main process forwards
events to the renderer through `yomi:event`.

## Auth Flow

1. Desktop requests a device code from the backend.
2. Desktop opens the system browser.
3. User completes OAuth through Better Auth.
4. Desktop polls for a token.
5. Token is stored encrypted via `safeStorage`.
6. Backend requests use `Authorization: Bearer <token>`.

## Implemented Files

- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/main/settings.ts`
- `apps/desktop/src/main/auth.ts`
- `apps/desktop/src/main/capture.ts`
- `apps/desktop/src/main/sidecar.ts`
- `apps/desktop/src/main/guide-overlay.ts`
- `apps/desktop/src/main/spatial-mapping.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/global.d.ts`
- `apps/desktop/src/renderer/theme.tsx`
- `apps/desktop/src/renderer/mission/MissionControl.tsx`

## Future Work

- Native mic capture in main process.
- Multi-monitor capture source selection.
- Packaged sidecar binary management for release builds.
- macOS Accessibility API helper (analogous to Windows uia-helper).
