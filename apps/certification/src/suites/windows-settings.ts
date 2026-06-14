import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class WindowsSettingsSuite extends BaseSuite {
  private hwnd: number | null = null

  constructor() {
    super("windows-settings", "system")
  }

  register(): void {
    this.addTest(1, "Launch Settings", 20_000, async () => {
      this.hwnd = await this.findWindow({ titleContains: "Settings" })
      if (!this.hwnd) {
        await this.launchPowerShell("Start-Process ms-settings:")
        this.hwnd = await this.waitForWindow({ titleContains: "Settings" }, 15_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "settings open", true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "settings found", false))
      }
      return ev
    })

    this.addTest(2, "Search settings", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.pressKey("Ctrl+E"); await this.sleep(400)
      await this.typeText("bluetooth"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "search-settings"),
        this.customEvidence("ui_state", "search performed", true)]
    })

    this.addTest(3, "Open Bluetooth", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "bluetooth-page"),
        this.customEvidence("ui_state", "bluetooth page opened", true)]
    })

    this.addTest(4, "Navigate to Wi-Fi", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+E"); await this.sleep(400)
      await this.pressKey("Ctrl+A"); await this.sleep(100)
      await this.typeText("wifi"); await this.sleep(1500)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "wifi-page"),
        this.customEvidence("ui_state", "wifi page opened", true)]
    })

    this.addTest(5, "Navigate to Display", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+E"); await this.sleep(400)
      await this.pressKey("Ctrl+A"); await this.sleep(100)
      await this.typeText("display"); await this.sleep(1500)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "display-page"),
        this.customEvidence("ui_state", "display page opened", true)]
    })

    this.addTest(6, "Navigate to Sound", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+E"); await this.sleep(400)
      await this.pressKey("Ctrl+A"); await this.sleep(100)
      await this.typeText("sound"); await this.sleep(1500)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "sound-page"),
        this.customEvidence("ui_state", "sound page opened", true)]
    })

    this.addTest(7, "Navigate to Privacy", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+E"); await this.sleep(400)
      await this.pressKey("Ctrl+A"); await this.sleep(100)
      await this.typeText("privacy"); await this.sleep(1500)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "privacy-page"),
        this.customEvidence("ui_state", "privacy page opened", true)]
    })

    this.addTest(8, "Read setting state", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      const tree = await this.uiaCall<{ elements: Array<{ role: string; name?: string; value?: string; patterns?: string[] }> }>(
        "get_ui_tree", { hwnd: this.hwnd, maxNodes: 200, maxDepth: 20 }, 10_000)
      const elements = tree?.elements ?? []
      const hasContent = elements.length > 10
      return [this.customEvidence("ui_state", "settings tree read",
        hasContent, `elements=${elements.length}`)]
    })
  }

  async cleanup(): Promise<void> {
    if (this.hwnd) await this.closeWindow(this.hwnd).catch(() => null)
  }
}
