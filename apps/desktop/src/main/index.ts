import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, shell } from "electron"
import path from "node:path"
import { SidecarManager } from "./sidecar"
import { checkStoredToken, startDeviceCodeFlow, clearToken, loadToken, BACKEND_URL } from "./auth"
import { initHotkey, enableHotkeys, disableHotkeys, suspendHotkeys, resumeHotkeys, triggerEscape } from "./hotkey"
import { initSidecarIpc } from "./ipc"

// Transparent frameless windows need software compositing on some GPU/driver combos
if (process.platform === "win32") {
  app.commandLine.appendSwitch("enable-transparent-visuals")
  app.commandLine.appendSwitch("disable-gpu-program-cache")
}

let overlayWin: BrowserWindow | null = null
let sidecarStarted = false  // Sidecar + IPC + hotkeys initialised (once ever)

app.whenReady().then(async () => {
  // Platform-specific tray/menubar setup
  if (process.platform === "darwin") {
    const { setupMac } = await import("./platform/mac")
    setupMac()
  } else {
    const { setupWindows } = await import("./platform/windows")
    setupWindows()
  }

  // Position overlay at top-center of primary display
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize
  const overlayW = 680
  const overlayX = Math.round((screenW - overlayW) / 2)

  overlayWin = new BrowserWindow({
    width: overlayW,
    height: 46,
    x: overlayX,
    y: 8,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    ...(process.platform === "darwin" ? { type: "tooltip" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.platform !== "darwin") {
    overlayWin.setAlwaysOnTop(true, "screen-saver")
  }
  overlayWin.setContentProtection(true)
  overlayWin.setVisibleOnAllWorkspaces(true)

  // ── Overlay window control IPCs (no auth required) ─────────────────────────

  // Renderer-side ESC fallback — fires when globalShortcut("Escape") fails to register.
  // triggerEscape() internally calls onAnyEscape (stop-audio), so no extra send needed.
  ipcMain.on("yomi:escape", () => triggerEscape())

  // Returns the first screen source ID for system audio loopback capture in the renderer
  ipcMain.handle("yomi:get-desktop-source-id", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] })
    return sources[0]?.id ?? null
  })

  ipcMain.on("yomi:resize", (_e, w: number, h: number) => {
    if (!overlayWin) return
    overlayWin.setSize(Math.max(240, w), Math.max(46, h))
  })

  ipcMain.on("yomi:set-ignore-mouse-events", (_e, ignored: boolean) => {
    if (!overlayWin) return
    if (ignored) overlayWin.setIgnoreMouseEvents(true, { forward: true })
    else overlayWin.setIgnoreMouseEvents(false)
  })

  let dragStart = { winX: 0, winY: 0, mouseX: 0, mouseY: 0 }
  ipcMain.on("yomi:drag-start", (_e, mouseX: number, mouseY: number) => {
    const pos = overlayWin?.getPosition() ?? [0, 0]
    dragStart = { winX: pos[0] ?? 0, winY: pos[1] ?? 0, mouseX, mouseY }
  })
  ipcMain.on("yomi:drag-move", (_e, mouseX: number, mouseY: number) => {
    const dx = mouseX - dragStart.mouseX
    const dy = mouseY - dragStart.mouseY
    overlayWin?.setPosition(dragStart.winX + dx, dragStart.winY + dy)
  })
  ipcMain.on("yomi:nudge", (_e, dx: number, dy: number) => {
    const [x, y] = overlayWin?.getPosition() ?? [0, 0]
    overlayWin?.setPosition((x ?? 0) + dx, (y ?? 0) + dy)
  })

  // ── Auth IPC ────────────────────────────────────────────────────────────────

  ipcMain.handle("yomi:start-auth", async (_e, provider?: string) => {
    if (!overlayWin) return
    try {
      const token = await startDeviceCodeFlow(provider, (deviceUrl) => {
        shell.openExternal(deviceUrl)
        overlayWin?.webContents.send("yomi:auth-waiting")
      })
      await completeSetup(token)
      overlayWin?.webContents.send("yomi:auth-ok")
    } catch (err) {
      overlayWin?.webContents.send(
        "yomi:auth-error",
        err instanceof Error ? err.message : "Sign-in failed",
      )
    }
  })

  ipcMain.on("yomi:sign-out", () => {
    clearToken()
    disableHotkeys()
    overlayWin?.webContents.send("yomi:auth-needed")
  })

  ipcMain.on("yomi:quit", () => app.quit())

  ipcMain.on("yomi:open-upgrade", () => {
    const base = process.env["YOMI_LANDING_URL"] ?? "http://localhost:3000"
    shell.openExternal(`${base}/pricing`)
  })

  ipcMain.on("yomi:set-opacity", (_e, value: number) => {
    overlayWin?.setOpacity(Math.max(0.1, Math.min(1, value)))
  })

  // Handle 401 from subscription check — triggers re-auth
  ipcMain.handle("yomi:get-subscription-info", async () => {
    const token = loadToken()
    if (!token) return null
    try {
      const backendUrl = process.env["BACKEND_URL"] ?? process.env["YOMI_BACKEND_URL"] ?? "http://localhost:3001"
      const res = await fetch(`${backendUrl}/api/billing/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        clearToken()
        disableHotkeys()
        overlayWin?.webContents.send("yomi:auth-needed")
        return null
      }
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  })

  // ── Load overlay ────────────────────────────────────────────────────────────

  if (process.env.ELECTRON_RENDERER_URL) {
    overlayWin.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    overlayWin.loadFile(path.join(__dirname, "../renderer/index.html"))
  }

  overlayWin.once("ready-to-show", async () => {
    overlayWin?.show()
    // Check for a stored token in the background — renderer is already showing "checking" state
    const token = await checkStoredToken()
    if (token) {
      await completeSetup(token)
      overlayWin?.webContents.send("yomi:auth-ok")
    } else {
      overlayWin?.webContents.send("yomi:auth-needed")
    }
  })

  // ── Overlay keyboard shortcuts (no auth required) ───────────────────────────

  // Ctrl+Shift+Arrow — smooth overlay movement
  const NUDGE_DIRS: [string, number, number][] = [
    ["Ctrl+Shift+Left",  -1,  0],
    ["Ctrl+Shift+Right",  1,  0],
    ["Ctrl+Shift+Up",     0, -1],
    ["Ctrl+Shift+Down",   0,  1],
  ]
  let nudgeDir = { x: 0, y: 0 }
  let nudgeVel = { x: 0, y: 0 }
  let nudgeTick: ReturnType<typeof setInterval> | null = null
  let nudgeStop: ReturnType<typeof setTimeout> | null = null
  const NUDGE_MAX = 24, NUDGE_ACCEL = 3

  const stopNudging = () => {
    if (nudgeTick) { clearInterval(nudgeTick); nudgeTick = null }
    if (nudgeStop) { clearTimeout(nudgeStop); nudgeStop = null }
    nudgeDir = { x: 0, y: 0 }
    nudgeVel = { x: 0, y: 0 }
  }

  for (const [combo, dx, dy] of NUDGE_DIRS) {
    globalShortcut.register(combo, () => {
      if (!overlayWin) return
      nudgeDir = { x: dx, y: dy }
      if (nudgeStop) clearTimeout(nudgeStop)
      nudgeStop = setTimeout(stopNudging, 150)
      if (!nudgeTick) {
        nudgeTick = setInterval(() => {
          if (!overlayWin) { stopNudging(); return }
          nudgeVel.x = nudgeDir.x === 0 ? 0 : Math.min(Math.abs(nudgeVel.x) + NUDGE_ACCEL, NUDGE_MAX) * Math.sign(nudgeDir.x)
          nudgeVel.y = nudgeDir.y === 0 ? 0 : Math.min(Math.abs(nudgeVel.y) + NUDGE_ACCEL, NUDGE_MAX) * Math.sign(nudgeDir.y)
          const [x, y] = overlayWin.getPosition()
          overlayWin.setPosition(Math.round((x ?? 0) + nudgeVel.x), Math.round((y ?? 0) + nudgeVel.y))
        }, 16)
      }
    })
  }

  let visible = true
  globalShortcut.register("Ctrl+Shift+H", () => {
    if (!overlayWin) return
    visible = !visible
    if (visible) {
      overlayWin.show()
      resumeHotkeys()
    } else {
      overlayWin.hide()
      suspendHotkeys()
    }
  })

  globalShortcut.register("Ctrl+Shift+Q", () => app.quit())
})

// Session validation — periodically check the token is still valid.
// Catches cross-device sign-out (landing page → desktop re-auth).
function startSessionValidation() {
  setInterval(async () => {
    const token = loadToken()
    if (!token) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/billing/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        clearToken()
        disableHotkeys()
        overlayWin?.webContents.send("yomi:auth-needed")
      }
    } catch {
      // Network error — ignore, retry next interval
    }
  }, 30_000)
}

// Called after a valid token is obtained.
// First call: starts sidecar, registers IPC handlers, registers shortcuts.
// Subsequent calls (re-auth after sign-out): just re-enables the shortcuts.
async function completeSetup(token: string) {
  if (!overlayWin) return

  if (!sidecarStarted) {
    sidecarStarted = true

    const sidecar = new SidecarManager(token)
    try {
      await sidecar.start()
    } catch (err) {
      if (process.env.YOMI_DEV === "true") {
        console.warn("[yomi] sidecar not running — start it separately: cd apps/sidecar && bun run dev")
      } else {
        console.error("[yomi] sidecar failed to start:", err)
      }
    }

    const { onListenStop, onTextQuery, onAbort } = initSidecarIpc(sidecar, overlayWin)

    initHotkey({
      onStateChange: (s) => {
        if (s === "text-input") {
          // Ensure overlay is visible before focusing, then focus so the
          // input field can receive keyboard input immediately.
          overlayWin?.show()
          overlayWin?.focus()
        } else if (s === "listening") {
          // Show overlay so the user sees the recording indicator and ESC hint.
          overlayWin?.show()
        }
        overlayWin?.webContents.send("yomi:state", s)
      },
      onListenStop,
      onTextQuery,
      onAbort,
      // Fires on every ESC press regardless of state — stops TTS playback even
      // when the pipeline has already finished and state is back to idle.
      onAnyEscape: () => overlayWin?.webContents.send("yomi:stop-audio"),
    })

    startSessionValidation()
  } else {
    // Re-auth after sign-out: sidecar already running, just unlock shortcuts
    enableHotkeys()
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("will-quit", () => globalShortcut.unregisterAll())
