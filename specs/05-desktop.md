# Spec 05 — Desktop Shell

## Purpose

Define the Electron app structure, platform adapters (macOS / Windows / Linux), capture abstractions, and the deep-link auth flow. The shell is pure OS integration — no AI logic lives here.

## Invariants

- The desktop app makes NO direct LLM calls. Everything goes to the sidecar.
- One capture abstraction, three thin platform adapters. No forks of the whole app per OS.
- Login happens in the system browser, never in an embedded Electron window.
- The sidecar must be running before the desktop window opens. If it's not, restart it.

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
  renderer/
    index.html        Shell HTML
    app.tsx           React floating UI
    components/
      BuddyWindow.tsx      The main floating window
      StatusPill.tsx       Notch / tray status indicator
      Settings.tsx         Settings panel
      GuideOverlay.tsx     Transparent overlay with step arrows
      GuideStep.tsx        Single step highlight with label
```

### Platform Adapters

**macOS (`platform/mac.ts`)**
- `NSStatusItem` via `@napi-rs/menu` or native module: tray icon + dropdown menu.
- Notch pill: a borderless always-on-top `BrowserWindow` positioned under the notch (y = 0, x = screen.width/2 - 100). Shows live status (listening / thinking / done) using a `StatusPill` React component.
- On first run: request Microphone, Screen Recording, Accessibility via `systemPreferences.askForMediaAccess`.

**Windows (`platform/windows.ts`)**
- System tray via `electron.Tray` with context menu (Quick ask / Open / Settings / Quit).
- Toast notifications via `electron.Notification` for completed agent tasks.
- Global hotkey via `electron.globalShortcut`.

**Linux / Omarchy (`platform/linux.ts`)**
- Waybar custom module: Yomi writes a JSON file to `/tmp/yomi-waybar.json`; Waybar reads it via `exec` module. Includes status text + click command.
- On click: `hyprctl dispatch exec` to open the buddy window.
- Fallback: `AppIndicator` (libayatana) for non-Waybar desktops.
- Ship a `hyprland.conf` snippet in `docs/hyprland-keybind.md`.

### Capture Abstraction

```typescript
// capture.ts
interface CaptureProvider {
  grabScreen(): Promise<Buffer>          // PNG screenshot
  startMicStream(): AsyncIterator<Buffer>  // PCM chunks
  stopMicStream(): void
}

// Platform implementations use:
// macOS: ScreenCaptureKit + AVAudioEngine (native module)
// Windows: DXGI Desktop Duplication + WASAPI
// Linux: PipeWire / PulseAudio + X11/Wayland screen capture
```

The capture module runs in the main process. Screenshots are base64-encoded and sent to the sidecar in the IPC request body. Audio chunks stream over the IPC connection.

### Sidecar Lifecycle

```typescript
// sidecar.ts
class SidecarManager {
  private process: ChildProcess | null = null

  async start() {
    this.process = spawn('bun', ['run', SIDECAR_ENTRY], {
      env: { ...process.env, SIDECAR_SECRET },
    })
    await this.waitForHealth()  // poll GET /health until 200
  }

  async restart() {
    this.process?.kill()
    await sleep(500)
    await this.start()
  }

  // Health-check loop: every 10s, GET /health
  // If 3 consecutive failures → restart sidecar
}
```

The sidecar binary is bundled with the Electron app in `resources/sidecar/`. It is spawned as a child process of the main process and killed when the app quits.

### Auth Flow (deep-link)

1. User clicks "Sign in" → `shell.openExternal(backendUrl + /auth/signin?redirect=yomi://auth/callback)`.
2. Better Auth handles OAuth in the system browser.
3. On success, backend redirects to `yomi://auth/callback?token=<jwt>`.
4. Electron registers the `yomi://` protocol handler. On callback, extract token.
5. Store token in OS keychain (`keytar` on macOS/Windows, `libsecret` on Linux).
6. Pass token to sidecar via secure IPC on each request.

### Visual Guide Overlay

When the fast path runs in `guide` mode, the desktop renders a transparent click-through overlay with step arrows.

**GuideOverlay component:**
```
┌─────────────────────────────────────────────┐
│  ← Step 2 of 4  →  ✕                        │  ← nav bar (always-on-top)
│                                              │
│                                              │
│        ┌──────────────┐                     │
│        │ Messages tab  │ ← ─ ─ ─ ─ ─ ─      │  ← highlighted element
│        │ ┌───┐        │                      │     with arrow
│        │ │ 3 │        │                     │
│        │ └───┘        │                     │
│        └──────────────┘                     │
│                                              │
│  Click the Messages tab at the top left      │  ← instruction text
└─────────────────────────────────────────────┘
```

```typescript
// renderer/components/GuideOverlay.tsx
interface GuideElement {
  label: string
  bbox: { x: number; y: number; width: number; height: number }
}

interface GuideStep {
  instruction: string
  elements: GuideElement[]
}

// The overlay is a borderless, transparent, always-on-top BrowserWindow
// positioned at (0, 0) spanning the full screen
// Mouse events pass through to the underlying app (transparent for clicks)
// Only the arrows and labels are painted
//
// Arrow rendering: draw a line from the nearest edge of the element
// to a label positioned outside the element bounding box
// Use CSS pointer-events: none on the overlay window
```

**Implementation:**
- A separate `BrowserWindow` with `transparent: true`, `frame: false`, `alwaysOnTop: true`, `clickable: false` (mouse passthrough)
- React renders SVG arrows + labels at the bounding box coordinates received from the sidecar
- Nav bar (Step X of Y, Prev/Next, Close) is the only interactive region — `pointer-events: auto`
- On Close or last step, the overlay window is hidden
- If the user resizes/moves the target window, the overlay breaks — show a "refresh" button to re-screenshot and recalculate

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
- `apps/desktop/src/renderer/app.tsx` — React floating UI
- `apps/desktop/src/renderer/components/BuddyWindow.tsx` — Main floating window
- `apps/desktop/src/renderer/components/StatusPill.tsx` — Notch/tray status indicator
- `apps/desktop/src/renderer/components/Settings.tsx` — Settings panel
- `apps/desktop/src/renderer/components/GuideOverlay.tsx` — Visual guide overlay
- `apps/desktop/src/renderer/components/GuideStep.tsx` — Single step highlight

## Open Questions

- Tauri port (Phase 4): evaluate based on Electron pain points. Capture + hotkeys are the most native-sensitive parts. The sidecar is unchanged.
- Auto-update: `electron-updater` for staged rollouts. Not needed until Phase 5.
