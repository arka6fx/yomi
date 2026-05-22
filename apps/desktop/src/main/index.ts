import { app, BrowserWindow, globalShortcut, screen } from "electron"
import path from "node:path"
import { SidecarManager } from "./sidecar"
import { initHotkey } from "./hotkey"
import { initIpc } from "./ipc"

// Transparent frameless windows need software compositing on some GPU/driver combos
if (process.platform === "win32") {
  app.commandLine.appendSwitch("enable-transparent-visuals")
  app.commandLine.appendSwitch("disable-gpu-program-cache")
}

let overlayWin: BrowserWindow | null = null
const sidecar = new SidecarManager()

app.whenReady().then(async () => {
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
    width: 520,
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

  // Ctrl+Arrow — nudge overlay position (30px steps)
  const STEP = 30
  const nudge = (dx: number, dy: number) => {
    if (!overlayWin) return
    const [x, y] = overlayWin.getPosition()
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    overlayWin.setPosition(
      Math.max(0, Math.min(width  - 520, x + dx)),
      Math.max(0, Math.min(height - 46,  y + dy)),
    )
  }
  globalShortcut.register("Ctrl+Up",    () => nudge(0, -STEP))
  globalShortcut.register("Ctrl+Down",  () => nudge(0,  STEP))
  globalShortcut.register("Ctrl+Left",  () => nudge(-STEP, 0))
  globalShortcut.register("Ctrl+Right", () => nudge( STEP, 0))

  // Ctrl+Shift+H — toggle overlay visibility
  let visible = true
  globalShortcut.register("Ctrl+Shift+H", () => {
    if (!overlayWin) return
    visible = !visible
    if (visible) overlayWin.show()
    else overlayWin.hide()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
