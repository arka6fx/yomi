import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class SystemCommandsSuite extends BaseSuite {
  constructor() {
    super("system-commands", "system_controls")
  }

  register(): void {
    this.addTest(1, "Open Task Manager", 15_000, async () => {
      const ev: Evidence[] = []
      await this.pressKey("Ctrl+Shift+Escape"); await this.sleep(3000)
      const hwnd = await this.waitForWindow({ titleContains: "Task Manager" }, 10_000)
      if (hwnd) {
        ev.push(this.customEvidence("process_state", "Task Manager opened", true, `hwnd=${hwnd}`))
        ev.push(await this.screenshot("task-manager"))
        ev.push(await this.uiTree(hwnd, "task-manager-tree"))
        await this.closeWindow(hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "Task Manager", false))
      }
      return ev
    })

    this.addTest(2, "Open Control Panel", 15_000, async () => {
      const ev: Evidence[] = []
      await this.launchPowerShell("control.exe"); await this.sleep(2000)
      const hwnd = await this.waitForWindow({ titleContains: "Control Panel" }, 5_000)
      if (hwnd) {
        ev.push(this.customEvidence("process_state", "Control Panel opened", true, `hwnd=${hwnd}`))
        ev.push(await this.screenshot("control-panel"))
        await this.closeWindow(hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "Control Panel", false))
      }
      return ev
    })

    this.addTest(3, "Run command via cmd.exe", 15_000, async () => {
      const ev: Evidence[] = []
      const fixed = "C:\\Users\\arkag\\AppData\\Local\\Temp\\yomi-cmd-test.txt"
      // Use Out-File with UTF8 to avoid PowerShell's default UTF-16 encoding
      await this.launchPowerShell(
        `cmd.exe /c echo YomiCertified | Out-File "${fixed}" -Encoding UTF8`)
      await this.sleep(1000)
      const exists = existsSync(fixed)
      if (exists) {
        const content = readFileSync(fixed, "utf-8").trim()
        ev.push(this.customEvidence("filesystem", "cmd output",
          content === "YomiCertified", `content="${content}"`))
        ev.push(await this.screenshot("cmd-output"))
      } else {
        ev.push(this.customEvidence("filesystem", "cmd output", false,
          "cmd.exe did not produce output"))
      }
      return ev
    })

    this.addTest(4, "Lock PC", 15_000, async () => {
      const ev: Evidence[] = []
      const r = await this.uiaCall<{ ok: boolean }>("lock_pc", {}, 5_000)
      ev.push(this.customEvidence("process_state", "lock_pc", r?.ok === true,
        r?.ok ? "workstation locked" : "lock command failed"))
      return ev
    })
  }
}
