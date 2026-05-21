# Spec 12 — Desktop: Shell

## Purpose

Define the Electron main process structure, platform adapters (macOS / Windows / Linux), capture abstraction, sidecar lifecycle management, and deep-link auth flow. The shell is pure OS integration — no AI logic lives here.

## Invariants

- The desktop app makes NO direct LLM calls. Everything goes to the sidecar.
- One capture abstraction, three thin platform adapters. No forks per OS.
- Login happens in the system browser, never in an embedded Electron window.
- The sidecar must be running before the desktop window opens. If not, restart it.

## Detailed Design

### Electron Process Structure

```
apps/desktop/src/
  main/
    index.ts          Entry point. Manages app lifecycle, tray, windows.
    sidecar.ts        Spawn + monitor the local sidecar process.
    capture.ts        Screen + mic capture (native Node bindings).
    hotkey.ts         Global hotkey registration.
    ipc.ts            IPC bridge: renderer ↔ main ↔ sidecar.
    platform/
      mac.ts          NSStatusItem, notch pill, permissions prompt.
      windows.ts      Tray icon, toast notifications.
      linux.ts        Waybar module socket, AppIndicator fallback.
  preload/
    index.ts          Expose safe IPC methods to renderer via contextBridge.
```

### Platform Adapters

**macOS (`platform/mac.ts`):**
- `NSStatusItem` via `@napi-rs/menu` or native module: tray icon + dropdown.
- Notch pill: borderless always-on-top `BrowserWindow` at y=0, center of screen. Shows live status.
- First run: request Microphone, Screen Recording, Accessibility permissions.

**Windows (`platform/windows.ts`):**
- System tray via `electron.Tray` with context menu.
- Toast notifications via `electron.Notification` for agent task completion.
- Global hotkey via `electron.globalShortcut`.

**Linux / Omarchy (`platform/linux.ts`):**
- Waybar custom module: writes JSON to `/tmp/yomi-waybar.json`; Waybar reads via `exec` module.
- On click: `hyprctl dispatch exec` to open the buddy window.
- Fallback: `AppIndicator` (libayatana) for non-Waybar desktops.
- Ship `hyprland.conf` snippet in `docs/hyprland-keybind.md`.

### Capture Abstraction

```typescript
interface CaptureProvider {
  grabScreen(): Promise<Buffer>          // PNG screenshot
  startMicStream(): AsyncIterator<Buffer>  // PCM chunks
  stopMicStream(): void
}
```

Platform implementations: macOS (ScreenCaptureKit + AVAudioEngine), Windows (DXGI + WASAPI), Linux (PipeWire + X11/Wayland).

### Sidecar Lifecycle

```typescript
class SidecarManager {
  private process: ChildProcess | null = null

  async start() {
    this.process = spawn('bun', ['run', SIDECAR_ENTRY], {
      env: { ...process.env, SIDECAR_SECRET },
    })
    await this.waitForHealth()
  }

  async restart() {
    this.process?.kill()
    await sleep(500)
    await this.start()
  }
}
```

Health-check loop: every 10s, `GET /health`. If 3 consecutive failures → restart sidecar.

### Auth Flow (deep-link)

1. User clicks "Sign in" → `shell.openExternal(backendUrl + /auth/signin?redirect=yomi://auth/callback)`.
2. Better Auth handles OAuth in system browser.
3. Backend redirects to `yomi://auth/callback?token=<jwt>`.
4. Electron registers `yomi://` protocol handler. On callback, extract token.
5. Store token in OS keychain (keytar / libsecret).
6. Pass token to sidecar via secure IPC on each request.

## Files to change

- `apps/desktop/src/main/index.ts` — App lifecycle, window creation, sidecar spawn
- `apps/desktop/src/preload/index.ts` — Context bridge for safe IPC

## Files to create

- `apps/desktop/src/main/sidecar.ts` — SidecarManager: spawn + health-check + restart
- `apps/desktop/src/main/capture.ts` — CaptureProvider abstraction (screen + mic)
- `apps/desktop/src/main/hotkey.ts` — Global hotkey registration
- `apps/desktop/src/main/ipc.ts` — IPC bridge: renderer ↔ main ↔ sidecar
- `apps/desktop/src/main/platform/mac.ts` — macOS: NSStatusItem, notch pill
- `apps/desktop/src/main/platform/windows.ts` — Windows: Tray, toast notifications
- `apps/desktop/src/main/platform/linux.ts` — Linux: Waybar module, AppIndicator

## Open Questions

- Auto-update: `electron-updater` for staged rollouts. Not needed until Phase 5.
- Tauri port (Phase 4): evaluate based on Electron pain points. Capture + hotkeys are the most native-sensitive parts.
