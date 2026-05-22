import { app, BrowserWindow } from "electron"
import path from "node:path"
import { SidecarManager } from "./sidecar"
import { initHotkey } from "./hotkey"
import { initIpc } from "./ipc"

if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto")
}

let overlayWin: BrowserWindow | null = null
const sidecar = new SidecarManager()

app.whenReady().then(async () => {
  // Platform setup: tray, dock visibility
  if (process.platform === "darwin") {
    const { setupMac } = await import("./platform/mac")
    setupMac()
  } else if (process.platform === "win32") {
    const { setupWindows } = await import("./platform/windows")
    setupWindows()
  } else {
    const { setupLinux } = await import("./platform/linux")
    setupLinux()
  }

  // Start sidecar and wait until healthy before opening the window
  try {
    await sidecar.start()
  } catch (err) {
    console.error("[yomi] sidecar failed to start — retrying in 3s", err)
    await new Promise((r) => setTimeout(r, 3000))
    await sidecar.start()
  }

  // Overlay window — frameless, transparent, always-on-top
  overlayWin = new BrowserWindow({
    width: 480,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false, // shown explicitly after setContentProtection
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Must be called BEFORE win.show() — excludes overlay from screen recordings
  overlayWin.setContentProtection(true)
  overlayWin.setVisibleOnAllWorkspaces(true) // visible across macOS Spaces

  if (process.env.ELECTRON_RENDERER_URL) {
    overlayWin.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    overlayWin.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
  overlayWin.once("ready-to-show", () => overlayWin!.show())

  // Wire IPC bridge (audio chunks, STT, sidecar SSE)
  const { onListenStop } = initIpc(sidecar, overlayWin)

  // Register global hotkeys (must be after whenReady)
  initHotkey({
    onStateChange: (s) => {
      overlayWin!.webContents.send("yomi:state", s)
      if (process.platform === "linux") {
        import("./platform/linux").then((m) => m.writeWaybar(s))
      }
    },
    onListenStop,
  })
})

// macOS: keep process alive when all windows are hidden (tray-only app)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
