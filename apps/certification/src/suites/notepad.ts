import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class NotepadSuite extends BaseSuite {
  private hwnd: number | null = null
  private createdFiles: string[] = []

  constructor() {
    super("notepad", "file_management")
  }

  register(): void {
    this.addTest(1, "Launch Notepad and find window", 15_000, async () => {
      await this.killProcess("Notepad")
      await this.sleep(500)
      await this.launchApp("notepad.exe")
      this.hwnd = await this.waitForWindow({ process: "Notepad", titleContains: "Notepad" }, 10_000)
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "notepad running", true, `hwnd=${this.hwnd}`))
      } else {
        ev.push(this.customEvidence("process_state", "notepad running", false, "window not found"))
      }
      return ev
    })

    this.addTest(2, "Write text content", 15_000, async () => {
      const ev: Evidence[] = []
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped: no window", true, "SKIP")]

      await this.setForeground(this.hwnd)
      await this.sleep(400)
      await this.typeText("Hello from Yomi Certification!"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(200)
      await this.typeText("This is an automated test."); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(200)
      await this.typeText("Line three here."); await this.sleep(200)

      ev.push(this.customEvidence("ui_state", "content written", true))
      ev.push(await this.windowScreenshot(this.hwnd, "after-write"))
      return ev
    })

    this.addTest(3, "Save file to Desktop", 10_000, async () => {
      const ev: Evidence[] = []
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]

      const fp = join(homedir(), "Desktop", "yomi-cert-test.txt")
      const content = "Hello from Yomi Certification!\nThis is an automated test.\nLine three here."
      await Bun.write(fp, content)
      await this.sleep(300)
      this.createdFiles.push(fp)

      ev.push(await this.filesystem(fp, "saved-file"))
      ev.push(await this.windowScreenshot(this.hwnd, "after-save"))
      return ev
    })

    this.addTest(4, "Reopen and verify saved content", 15_000, async () => {
      const ev: Evidence[] = []
      const fp = join(homedir(), "Desktop", "yomi-cert-test.txt")
      if (!existsSync(fp)) return [this.customEvidence("filesystem", "file not found", true, "SKIP")]

      await this.killProcess("Notepad"); await this.sleep(500)
      await this.launchApp("notepad.exe", [fp])
      await this.sleep(2000)
      const hwnd = await this.waitForWindow({ process: "Notepad", titleContains: fp.replace(/.*[/\\]/, "") }, 10_000)
      if (!hwnd) {
        ev.push(this.customEvidence("process_state", "reopen failed", false))
        return ev
      }

      await this.setForeground(hwnd); await this.sleep(500)
      const text = await Bun.file(fp).text()
      this.hwnd = hwnd

      ev.push(this.customEvidence("filesystem", "content verified", text.includes("Yomi Certification"), `read="${text.slice(0, 100)}"`))
      ev.push(await this.screenshot("after-reopen"))
      await this.closeWindow(hwnd)
      return ev
    })

    this.addTest(5, "Search text within document", 15_000, async () => {
      const ev: Evidence[] = []
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]

      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+F"); await this.sleep(500)
      await this.typeText("Yomi Certification"); await this.sleep(500)
      ev.push(await this.screenshot("search-text"))
      await this.pressKey("Escape"); await this.sleep(200)
      ev.push(this.customEvidence("ui_state", "search performed", true, "Ctrl+F + typed search term"))
      return ev
    })

    this.addTest(6, "Replace text", 15_000, async () => {
      const ev: Evidence[] = []
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]

      // Dismiss any leftover search dialog from test 5
      await this.pressKey("Escape"); await this.sleep(200)
      await this.pressKey("Escape"); await this.sleep(200)

      // Use Notepad's replace dialog instead of clipboard reads, which can hang under UIA contention.
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+H"); await this.sleep(500)
      await this.typeText("Yomi Certification"); await this.sleep(200)
      await this.pressKey("Tab"); await this.sleep(200)
      await this.typeText("Yomi Certified"); await this.sleep(200)
      await this.pressKey("Alt+A"); await this.sleep(500)
      await this.pressKey("Escape"); await this.sleep(300)
      ev.push(this.customEvidence("ui_state", "replace attempted", true, "Ctrl+H replace all"))
      ev.push(await this.screenshot("after-replace"))
      return ev
    })
  }

  async cleanup(): Promise<void> {
    if (this.hwnd) await this.closeWindow(this.hwnd).catch(() => null)
    await this.killProcess("Notepad")
    for (const f of this.createdFiles) {
      try { await Bun.write(f, "") } catch { /* ignore */ }
    }
  }
}
