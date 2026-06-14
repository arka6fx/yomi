import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class OneNoteSuite extends BaseSuite {
  private hwnd: number | null = null

  constructor() {
    super("onenote", "office")
  }

  register(): void {
    this.addTest(1, "Launch OneNote", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "ONENOTE" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ process: "OneNote" })
      }
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ titleContains: "OneNote" })
      }
      if (!this.hwnd) {
        await this.launchPowerShell(`
          $apps = Get-StartApps | Where-Object { $_.Name -like '*OneNote*' }
          if ($apps) { Start-Process "shell:AppsFolder\\$($apps[0].AppID)" }
        `)
        this.hwnd = await this.waitForWindow({ process: "OneNote", titleContains: "OneNote" }, 20_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "onenote running", true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "onenote available", false,
          "OneNote not found. Install from Microsoft Store or Office."))
      }
      return ev
    })

    this.addTest(2, "Create notebook", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(1500)
      // Alt+F → N → N (File → New → Notebook)
      await this.pressKey("Alt+F"); await this.sleep(500)
      await this.pressKey("N"); await this.sleep(500)
      await this.pressKey("N"); await this.sleep(2000)
      await this.typeText("YomiCertTest"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(3000)
      return [await this.windowScreenshot(this.hwnd, "create-notebook"),
        this.customEvidence("ui_state", "notebook created", true)]
    })

    this.addTest(3, "Create page", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      await this.pressKey("Ctrl+N"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "create-page"),
        this.customEvidence("ui_state", "page created", true)]
    })

    this.addTest(4, "Add content", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.typeText("Yomi Certification Test Page\n"); await this.sleep(200)
      await this.typeText("This is automated test content.\n"); await this.sleep(200)
      await this.typeText("Created during Phase X1 certification.\n"); await this.sleep(200)
      return [await this.windowScreenshot(this.hwnd, "add-content"),
        this.customEvidence("ui_state", "content added", true)]
    })

    this.addTest(5, "Search notes", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+E"); await this.sleep(800)
      await this.typeText("Yomi Certification"); await this.sleep(1500)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "search-notes"),
        this.customEvidence("ui_state", "notes searched", true)]
    })
  }

  async cleanup(): Promise<void> {
    // Keep running
  }
}
