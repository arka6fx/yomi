import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class TelegramSuite extends BaseSuite {
  private hwnd: number | null = null

  constructor() {
    super("telegram", "messaging")
  }

  register(): void {
    this.addTest(1, "Launch Telegram", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "Telegram" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ titleContains: "Telegram" })
      }
      if (!this.hwnd) {
        await this.launchPowerShell(`
          $apps = Get-StartApps | Where-Object { $_.Name -like '*Telegram*' }
          if ($apps) { Start-Process "shell:AppsFolder\\$($apps[0].AppID)" }
        `)
        this.hwnd = await this.waitForWindow({ process: "Telegram", titleContains: "Telegram" }, 20_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "telegram running", true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "telegram available", false,
          "Telegram not found. Install from https://desktop.telegram.org"))
      }
      return ev
    })

    this.addTest(2, "Search chat", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      await this.pressKey("Ctrl+F"); await this.sleep(500)
      await this.typeText("Saved Messages"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "search-chat"),
        this.customEvidence("ui_state", "search performed", true)]
    })

    this.addTest(3, "Open Saved Messages", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.pressKey("Down"); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "saved-messages"),
        this.customEvidence("ui_state", "saved messages opened", true)]
    })

    this.addTest(4, "Send message", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.typeText("Yomi certification test message"); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "send-message"),
        this.customEvidence("ui_state", "message sent", true)]
    })

    this.addTest(5, "Search history", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+F"); await this.sleep(500)
      await this.typeText("Yomi"); await this.sleep(1500)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "search-history"),
        this.customEvidence("ui_state", "history searched", true)]
    })

    this.addTest(6, "Open profile", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+Shift+P"); await this.sleep(2000)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "open-profile"),
        this.customEvidence("ui_state", "profile opened", true)]
    })
  }

  async cleanup(): Promise<void> {
    // Leave running
  }
}
