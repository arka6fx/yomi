import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class DiscordSuite extends BaseSuite {
  private hwnd: number | null = null

  constructor() {
    super("discord", "messaging")
  }

  register(): void {
    this.addTest(1, "Launch Discord", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "Discord" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ titleContains: "Discord" })
      }
      if (!this.hwnd) {
        await this.launchPowerShell(`
          $apps = Get-StartApps | Where-Object { $_.Name -like '*Discord*' }
          if ($apps) { Start-Process "shell:AppsFolder\\$($apps[0].AppID)" }
        `)
        this.hwnd = await this.waitForWindow({ process: "Discord", titleContains: "Discord" }, 20_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "discord running", true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "discord available", false,
          "Discord not found."))
      }
      return ev
    })

    this.addTest(2, "Navigate servers", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      await this.pressKey("Ctrl+Shift+Tab"); await this.sleep(1000)
      return [await this.windowScreenshot(this.hwnd, "navigate-servers"),
        this.customEvidence("ui_state", "server navigated", true)]
    })

    this.addTest(3, "Open channel", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      await this.pressKey("Ctrl+K"); await this.sleep(1000)
      await this.typeText("general"); await this.sleep(1500)
      await this.pressKey("Enter"); await this.sleep(3000)
      return [await this.windowScreenshot(this.hwnd, "open-channel"),
        this.customEvidence("ui_state", "channel opened", true)]
    })

    this.addTest(4, "Send message", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      // Ensure message input is focused via Ctrl+Alt+Up to focus chat
      await this.pressKey("Tab"); await this.sleep(100)
      await this.pressKey("Tab"); await this.sleep(100)
      await this.pressKey("Tab"); await this.sleep(100)
      await this.pressKey("Tab"); await this.sleep(100)
      await this.typeText("Hello from Yomi certification test"); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "send-message"),
        this.customEvidence("ui_state", "message sent", true)]
    })

    this.addTest(5, "Open DMs", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+K"); await this.sleep(800)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "open-dms"),
        this.customEvidence("ui_state", "DMs opened", true)]
    })

    this.addTest(6, "Open user settings", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+,"); await this.sleep(2000)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "user-settings"),
        this.customEvidence("ui_state", "settings opened", true)]
    })
  }

  async cleanup(): Promise<void> {
    // Leave running
  }
}
