# Spec 03 - Desktop Shell

## Purpose

Define the Electron main process structure, platform adapters, capture abstraction, sidecar lifecycle, and device-code auth. The shell is OS integration only: no AI logic, memory retrieval, or prompt construction lives here.

## Invariants

- The desktop app makes no direct LLM calls. Everything goes to the sidecar.
- Login happens in the system browser, never in an embedded Electron window.
- The sidecar must be healthy before the overlay becomes interactive.
- Auth tokens are stored with Electron `safeStorage`.
- Local RAG is owned by the sidecar. The desktop does not expose file-upload RAG controls.

## Process Structure

```text
apps/desktop/src/
  main/
    index.ts       app lifecycle, tray, windows, hotkeys
    sidecar.ts     sidecar spawn, health, restart
    capture.ts     desktopCapturer screenshot capture
    hotkey.ts      global shortcut registration
    ipc.ts         renderer <-> main <-> sidecar/backend bridge
    auth.ts        device-code auth and encrypted token storage
  preload/
    index.ts       contextBridge API exposed to renderer
  renderer/
    app.tsx        overlay UI
```

## Sidecar Lifecycle

The main process starts the sidecar in packaged mode and expects it to already be running in `YOMI_DEV=true`.

```ts
class SidecarManager {
  readonly secret = crypto.randomUUID()
  readonly baseUrl = "http://127.0.0.1:3002"
}
```

Requests to the sidecar include `x-sidecar-secret`. Health is checked with `GET /health`; repeated failures restart the process.

## Capture

Electron `desktopCapturer` runs in the main process. The renderer never imports it.

```ts
const sources = await desktopCapturer.getSources({
  types: ["screen"],
  thumbnailSize: { width: 1920, height: 1080 },
})
```

Yomi windows call `setContentProtection(true)` before showing, so the overlay is excluded from screenshots and screen shares.

## Hotkeys

Default shortcuts:

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Start or stop voice capture |
| `Ctrl+Shift+Enter` | Open text input |
| `Ctrl+Shift+H` | Show or hide overlay |
| `Esc` | Cancel active input |

Hold-to-talk is not reliable across platforms, so voice uses toggle-to-talk.

## Fast Query Bridge

On submit, the desktop collects text or audio, captures a screenshot, reads account state, and sends:

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

The response is an SSE stream from `/query/fast`; the main process forwards events to the renderer through `yomi:event`.

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
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/global.d.ts`

## Future Work

- Native mic capture in main process.
- Multi-monitor capture source selection.
- Packaged sidecar binary management for release builds.
