import { app, BrowserWindow, globalShortcut } from "electron"
import path from "node:path"
import { SidecarManager } from "./sidecar"
import { ensureAuthenticated } from "./auth"
import { initHotkey } from "./hotkey"
import { initIpc } from "./ipc"

// Transparent frameless windows need software compositing on some GPU/driver combos
if (process.platform === "win32") {
  app.commandLine.appendSwitch("enable-transparent-visuals")
  app.commandLine.appendSwitch("disable-gpu-program-cache")
}

let overlayWin: BrowserWindow | null = null

app.whenReady().then(async () => {
  // Auth gate — must succeed before any UI is shown
  let sessionToken: string
  try {
    sessionToken = await ensureAuthenticated()
  } catch (err) {
    console.error("[yomi] auth failed:", err)
    app.quit()
    return
  }

  const sidecar = new SidecarManager(sessionToken)
  if (process.platform === "darwin") {
    const { setupMac } = await import("./platform/mac")
    setupMac()
  } else {
    const { setupWindows } = await import("./platform/windows")
    setupWindows()
  }

  try {
    await sidecar.start()
  } catch (err) {
    if (process.env.YOMI_DEV === "true") {
      console.warn("[yomi] sidecar not running in dev — start it separately: cd apps/sidecar && bun run dev")
    } else {
      console.error("[yomi] sidecar failed to start — retrying in 3s", err)
      await new Promise((r) => setTimeout(r, 3000))
      try { await sidecar.start() } catch (e) {
        console.error("[yomi] sidecar retry also failed — continuing without sidecar", e)
      }
    }
  }

  overlayWin = new BrowserWindow({
    width: 680,
    height: 46,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    type: "tooltip",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  overlayWin.setContentProtection(true)
  overlayWin.setVisibleOnAllWorkspaces(true)

  if (process.env.ELECTRON_RENDERER_URL) {
    overlayWin.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    overlayWin.loadFile(path.join(__dirname, "../renderer/index.html"))
  }

  const { onListenStop, onTextQuery } = initIpc(sidecar, overlayWin)

  initHotkey({
    onStateChange: (s) => {
      overlayWin!.webContents.send("yomi:state", s)
    },
    onListenStop,
    onTextQuery,
  })

  // Ctrl+Shift+Arrow — smooth overlay movement
  // globalShortcut fires on every OS key-repeat, so we use it as a heartbeat:
  // start a 16ms velocity loop on first press, reset a "released" timeout on each repeat,
  // and stop when no repeat arrives within 150ms (key was released).
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
      // Each repeat resets the "key released" deadline
      if (nudgeStop) clearTimeout(nudgeStop)
      nudgeStop = setTimeout(stopNudging, 150)
      // Start the smooth loop once per hold session
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

  // Ctrl+Shift+H — toggle overlay visibility
  let visible = true
  globalShortcut.register("Ctrl+Shift+H", () => {
    if (!overlayWin) return
    visible = !visible
    if (visible) overlayWin.show()
    else overlayWin.hide()
  })

  // Ctrl+Shift+Q — quit Yomi entirely
  globalShortcut.register("Ctrl+Shift+Q", () => app.quit())
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
