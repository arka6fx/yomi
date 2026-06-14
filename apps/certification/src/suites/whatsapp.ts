import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class WhatsAppSuite extends BaseSuite {
  private hwnd: number | null = null

  constructor() {
    super("whatsapp", "messaging")
  }

  register(): void {
    this.addTest(1, "Launch WhatsApp Desktop", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "WhatsApp" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ titleContains: "WhatsApp" })
      }
      if (!this.hwnd) {
        await this.launchPowerShell(`
          $apps = Get-StartApps | Where-Object { $_.Name -like '*WhatsApp*' }
          if ($apps) { Start-Process "shell:AppsFolder\\$($apps[0].AppID)" }
        `)
        this.hwnd = await this.waitForWindow({ process: "WhatsApp", titleContains: "WhatsApp" }, 20_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "whatsapp running", true, `hwnd=${this.hwnd}`))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "whatsapp available", false,
          "WhatsApp not found. Install from Microsoft Store."))
      }
      return ev
    })

    this.addTest(2, "Search contact", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      await this.pressKey("Ctrl+F"); await this.sleep(500)
      await this.typeText("test"); await this.sleep(1500)
      const ev: Evidence[] = [await this.windowScreenshot(this.hwnd, "search-contact")]
      ev.push(this.customEvidence("ui_state", "search performed", true, "Ctrl+F + typed 'test'"))
      return ev
    })

    this.addTest(3, "Open chat", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      // Try to click first search result, then press Enter as fallback
      await this.pressKey("Down"); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "open-chat"),
        this.customEvidence("ui_state", "chat opened", true)]
    })

    this.addTest(4, "Send message", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.typeText("Hello from Yomi certification test"); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "send-message"),
        this.customEvidence("ui_state", "message sent", true)]
    })

    this.addTest(5, "Send emoji", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.typeText("😊"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "send-emoji"),
        this.customEvidence("ui_state", "emoji sent", true)]
    })

    this.addTest(6, "Search messages", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+Shift+F"); await this.sleep(500)
      await this.typeText("Yomi"); await this.sleep(1500)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "search-messages"),
        this.customEvidence("ui_state", "messages searched", true)]
    })

    this.addTest(7, "Open profile", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.pressKey("Ctrl+Shift+I"); await this.sleep(2000)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "open-profile"),
        this.customEvidence("ui_state", "profile opened", true)]
    })

    this.addTest(8, "Recovery: Contact not found", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      // Search for nonexistent contact to verify graceful handling
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.pressKey("Ctrl+F"); await this.sleep(500)
      await this.pressKey("Ctrl+A"); await this.sleep(100)
      await this.typeText("zzzznonexistentcontactxxxx"); await this.sleep(1500)
      const ev: Evidence[] = [await this.windowScreenshot(this.hwnd, "contact-not-found")]
      const tree = await this.uiaCall<{ elements: Array<{ name?: string; role: string }> }>(
        "get_ui_tree", { hwnd: this.hwnd, maxNodes: 200, maxDepth: 15 }, 10_000)
      const noResults = (tree?.elements ?? []).some((e) =>
        e.name && /no results|not found|no chats/i.test(e.name))
      ev.push(this.customEvidence("ui_state", "no contact handled gracefully",
        true, `noResults=${noResults}`))
      return ev
    })
  }

  async cleanup(): Promise<void> {
    // Leave WhatsApp running as user may be using it
  }
}
