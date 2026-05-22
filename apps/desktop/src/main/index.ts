import { app, BrowserWindow } from "electron"
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
    width: 480,
    height: 200,
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

  const { onListenStop } = initIpc(sidecar, overlayWin)

  initHotkey({
    onStateChange: (s) => {
      overlayWin!.webContents.send("yomi:state", s)
    },
    onListenStop,
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
