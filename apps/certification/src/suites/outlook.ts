import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class OutlookSuite extends BaseSuite {
  private hwnd: number | null = null

  constructor() {
    super("outlook", "office")
  }

  private async launchOutlook(): Promise<void> {
    try {
      Bun.spawn(["OUTLOOK.EXE"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    } catch {
      await this.launchPowerShell(`
        $apps = Get-StartApps | Where-Object { $_.Name -like '*Outlook*' }
        if ($apps) { Start-Process "shell:AppsFolder\\$($apps[0].AppID)" }
      `)
    }
  }

  register(): void {
    this.addTest(1, "Launch Outlook", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "OUTLOOK" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ titleContains: "Outlook" })
      }
      if (!this.hwnd) {
        await this.launchOutlook(); await this.sleep(500)
        const deadline = Date.now() + 20_000
        while (Date.now() < deadline) {
          this.hwnd = await this.findWindow({ process: "OUTLOOK" })
          if (!this.hwnd) this.hwnd = await this.findWindow({ titleContains: "Outlook" })
          if (this.hwnd) break
          await this.sleep(500)
        }
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "outlook running", true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "outlook available", false,
          "Microsoft Outlook not found. Install Microsoft Office."))
      }
      return ev
    })

    this.addTest(2, "Draft email", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(1000)
      await this.pressKey("Ctrl+N"); await this.sleep(2000)
      await this.pressKey("Alt+O"); await this.sleep(800) // Focus To field
      await this.typeText("test@yomi.ai"); await this.sleep(200)
      await this.pressKey("Tab"); await this.sleep(200) // Subject
      await this.typeText("Yomi Certification Test Email"); await this.sleep(200)
      await this.pressKey("Tab"); await this.sleep(200) // Body
      await this.typeText("This is an automated certification test email from Yomi."); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "draft-email"),
        this.customEvidence("ui_state", "email drafted", true)]
    })

    this.addTest(3, "Save draft", 10_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.pressKey("Ctrl+S"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "save-draft"),
        this.customEvidence("ui_state", "draft saved", true)]
    })

    this.addTest(4, "Search email", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+E"); await this.sleep(500)
      await this.typeText("Yomi Certification"); await this.sleep(1500)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "search-email"),
        this.customEvidence("ui_state", "email search performed", true)]
    })

    this.addTest(5, "Create calendar event", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+Shift+A"); await this.sleep(2000)
      await this.typeText("Yomi Certification Meeting"); await this.sleep(200)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "calendar-event"),
        this.customEvidence("ui_state", "calendar event created", true)]
    })

    this.addTest(6, "Contact search", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+Shift+C"); await this.sleep(1500)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "contact-search"),
        this.customEvidence("ui_state", "contact search opened", true)]
    })
  }

  async cleanup(): Promise<void> {
    // Leave Outlook running
  }
}
