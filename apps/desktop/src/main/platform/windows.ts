import { Tray, Menu } from "electron"
import path from "node:path"

let tray: Tray | null = null

export function setupWindows(): void {
  tray = new Tray(path.join(__dirname, "../../../resources/tray-icon.ico"))
  tray.setToolTip("Yomi")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Yomi", enabled: false },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ]),
  )
}
