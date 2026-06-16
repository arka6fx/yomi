import { autoUpdater } from "electron-updater"
import type { BrowserWindow } from "electron"

let initialized = false

export function initAutoUpdater(win: BrowserWindow): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("update-available", (info) => {
    win.webContents.send("yomi:update-available", {
      version: info.version,
      releaseDate: info.releaseDate,
    })
  })

  autoUpdater.on("update-downloaded", (info) => {
    win.webContents.send("yomi:update-downloaded", {
      version: info.version,
    })
  })

  autoUpdater.on("download-progress", (info) => {
    win.webContents.send("yomi:update-progress", {
      percent: info.percent,
      bytesPerSecond: info.bytesPerSecond,
      transferred: info.transferred,
      total: info.total,
    })
  })

  autoUpdater.on("error", (err) => {
    console.warn("[yomi/updater] error:", err.message)
    win.webContents.send("yomi:update-error", { message: err.message })
  })

  checkAndNotify(win)

  setInterval(() => {
    checkAndNotify(win)
  }, 4 * 60 * 60 * 1000)
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => {
    console.warn("[yomi/updater] download failed:", err.message)
  })
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}

function checkAndNotify(win: BrowserWindow): void {
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn("[yomi/updater] check failed:", err.message)
    win.webContents.send("yomi:update-error", { message: err.message })
  })
}
