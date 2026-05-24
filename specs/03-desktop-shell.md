# Spec 03 — Desktop: Shell

## Purpose

Define the Electron main process structure, platform adapters (macOS / Windows), capture abstraction, sidecar lifecycle management, and device-code auth flow. The shell is pure OS integration — no AI logic lives here.

## Invariants

- The desktop app makes NO direct LLM calls. Everything goes to the sidecar.
- One capture abstraction, two thin platform adapters. No forks per OS.
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

### Capture Abstraction

```typescript
interface CaptureProvider {
  grabScreen(): Promise<Buffer>          // PNG screenshot
  startMicStream(): AsyncIterator<Buffer>  // PCM chunks
  stopMicStream(): void
}
```

Platform implementations: macOS (ScreenCaptureKit + AVAudioEngine), Windows (DXGI + WASAPI).

#### MVP Screenshot Implementation (`capture.ts`)

Electron's `desktopCapturer` is **main-process only** (Electron 17+). Never import in preload or renderer.

```ts
import { desktopCapturer } from "electron"
import type { NativeImage } from "electron"

export async function captureScreen(): Promise<string> {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1920, height: 1080 },
  })
  const thumb: NativeImage = sources[0].thumbnail
  const scaled = thumb.resize({ width: Math.min(1280, thumb.getSize().width) })
  return scaled.toJPEG(75).toString("base64")
}
```

Self-exclusion (keeping Yomi's overlay out of screenshots) is handled by `win.setContentProtection(true)` — the OS excludes the protected window from all capture output automatically.

### Sidecar Lifecycle

```typescript
class SidecarManager {
  readonly secret = crypto.randomUUID()   // generated at startup, injected into sidecar env
  readonly baseUrl = "http://127.0.0.1:3002"
  private process: ChildProcess | null = null

  async start() {
    // In dev (YOMI_DEV=true): skip spawn, sidecar is already running via `bun run dev`
    if (process.env.YOMI_DEV !== "true") {
      this.process = spawn("bun", ["run", SIDECAR_ENTRY], {
        env: { ...process.env, SIDECAR_SECRET: this.secret },
      })
    }
    await this.waitForHealth()
    this.startHealthLoop()
  }

  async restart() {
    this.process?.kill()
    await sleep(500)
    await this.start()
  }
}
```

Health-check loop: every 10s, `GET /health`. If 3 consecutive failures → restart sidecar.

### Global Hotkey

`electron.globalShortcut` fires **only on key-down** — there is no key-up event. Hold-to-talk is not reliably implementable cross-platform. Use **toggle-to-talk**: first press starts recording, second press stops and triggers the pipeline.

Default hotkey: `Ctrl+Shift+Space`. Register `Escape` as a cancel shortcut.

State machine: `idle →[hotkey] listening →[hotkey] processing →[done/error] idle`.

Register hotkeys only after `app.whenReady()` resolves.

### IPC Bridge (`ipc.ts`)

Orchestrates the full pipeline on `onListenStop`:

```
PCM chunks (from renderer, via yomi:audio-chunk IPC) → WAV buffer
Screenshot base64 (grabbed at onListenStart)
→ POST /query/fast to sidecar { text, screenshot_b64 }
→ SSE stream (Node fetch + ReadableStream.getReader())
→ overlayWin.webContents.send("yomi:event", sseEvent)
```

**IPC channels:**
| Direction | Channel | Payload |
|---|---|---|
| renderer → main | `yomi:audio-chunk` | `{ pcm: ArrayBuffer, sampleRate: number }` |
| main → renderer | `yomi:event` | `SseEvent` (from `@yomi/shared`) |
| main → renderer | `yomi:state` | `"idle" \| "listening" \| "processing"` |

**SSE reading** — use Node `fetch` + `ReadableStream.getReader()` in main process. `EventSource` is browser-only and not available in Electron main:

```ts
const res = await fetch(`${sidecar.baseUrl}/query/fast`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
  body: JSON.stringify({ text, screenshot_b64, mode: "answer" }),
})
const reader = res.body!.getReader()
const decoder = new TextDecoder()
let buf = ""
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  const lines = buf.split("\n")
  buf = lines.pop()!
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const event = JSON.parse(line.slice(6))
      overlayWin.webContents.send("yomi:event", event)
    }
  }
}
```

**STT:** The sidecar handles STT using Sarvam `saarika:v2.5`. The desktop sends raw audio bytes and the sidecar returns the transcript.

### Auth Flow (device-code)

1. User clicks "Sign in" and desktop requests `/api/auth/device-code`.
2. Desktop opens the system browser to the device confirmation page.
3. Landing confirms the code through the backend once the user is signed in.
4. Desktop polls `/api/auth/device-code/token` until it receives a session token.
5. Store token encrypted with Electron `safeStorage`.
6. Pass token to sidecar startup env and attach it to backend requests.

### Overlay Window

```ts
const overlay = new BrowserWindow({
  width: 480, height: 200, frame: false,
  transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false,
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
})
overlay.setContentProtection(true)                    // excluded from screen captures
overlay.setIgnoreMouseEvents(true, { forward: true }) // click-through when idle
overlay.setVisibleOnAllWorkspaces(true)               // visible across Spaces / virtual desktops
```

`setContentProtection(true)` must be called **before** `win.show()`. On macOS this sets `NSWindowSharingNone`; on Windows it uses `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`.

When the overlay displays a response, call `overlay.setIgnoreMouseEvents(false)` to accept mouse events (e.g. dismiss button). Restore click-through on `done` / idle.

**macOS Dock:** `app.dock?.hide()` — Yomi is a tray-only app, no Dock icon.

## Files to change

- `apps/desktop/src/main/index.ts` — Rewrite: tray, overlay window, content protection, wire all modules
- `apps/desktop/src/preload/index.ts` — Rewrite: full contextBridge API

## Files to create

- `apps/desktop/src/main/sidecar.ts` — SidecarManager: spawn + health-check + restart
- `apps/desktop/src/main/capture.ts` — `captureScreen()` via desktopCapturer
- `apps/desktop/src/main/hotkey.ts` — Toggle-to-talk via globalShortcut
- `apps/desktop/src/main/ipc.ts` — IPC bridge: sidecar SSE + renderer events
- `apps/desktop/src/main/platform/mac.ts` — macOS: NSStatusItem, notch pill _(after spec 04)_
- `apps/desktop/src/main/platform/windows.ts` — Windows: Tray, toast notifications

## Open Questions

- Auto-update: `electron-updater` for staged rollouts. Spec this separately before launch.
- Tauri port: evaluate based on Electron pain points. Capture + hotkeys are the most native-sensitive parts. Spec separately.
- Mic capture in main vs renderer: current design streams PCM from renderer `getUserMedia` via IPC. Native mic capture in main process (spec 05) avoids renderer overhead — migrate when spec 05 ships.
