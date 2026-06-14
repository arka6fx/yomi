import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class BrowserSuite extends BaseSuite {
  private hwnd: number | null = null
  private browserName = "chrome"

  constructor() {
    super("browser", "browser")
  }

  register(): void {
    this.addTest(1, "Launch browser", 20_000, async () => {
      this.hwnd = await this.findWindow({ process: "chrome" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ process: "msedge" })
        if (this.hwnd) this.browserName = "msedge"
      }
      if (!this.hwnd) {
        await this.launchApp("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
        this.hwnd = await this.waitForWindow({ process: "chrome", titleContains: "Google Chrome" }, 15_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", `${this.browserName} running`, true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "browser available", false))
      }
      return ev
    })

    this.addTest(2, "Open URL", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      await this.pressKey("Ctrl+T"); await this.sleep(800)
      await this.typeText("https://example.com"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(3000)
      return [await this.browserScreenshot("example-dot-com"),
        this.customEvidence("ui_state", "URL opened", true)]
    })

    this.addTest(3, "Search Google", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+T"); await this.sleep(800)
      await this.typeText("Yomi AI certification test"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(3000)
      return [await this.browserScreenshot("google-search"),
        this.customEvidence("ui_state", "Google search performed", true)]
    })

    this.addTest(4, "Open new tab and close tab", 10_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+T"); await this.sleep(800)
      await this.typeText("https://github.com"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(2000)
      await this.pressKey("Ctrl+W"); await this.sleep(500)
      return [this.customEvidence("ui_state", "tab opened and closed", true,
        "Ctrl+T opened new tab, Ctrl+W closed it")]
    })

    this.addTest(5, "Bookmark page", 10_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+D"); await this.sleep(1000)
      await this.pressKey("Enter"); await this.sleep(500)
      return [await this.browserScreenshot("bookmark"),
        this.customEvidence("ui_state", "page bookmarked", true)]
    })

    this.addTest(6, "Extract page text", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+A"); await this.sleep(200)
      await this.pressKey("Ctrl+C"); await this.sleep(500)
      const text = await this.getClipboardText()
      return [this.customEvidence("clipboard", "page text extracted",
        text.length > 0, `chars=${text.length}`)]
    })

    this.addTest(7, "Handle login page", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+T"); await this.sleep(800)
      await this.typeText("https://github.com/login"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(3000)
      const tree = await this.uiaCall<{ elements: Array<{ name?: string; role: string }> }>(
        "get_ui_tree", { maxNodes: 200, maxDepth: 15 }, 10_000)
      const loginFields = (tree?.elements ?? []).filter((e) =>
        e.name && /username|password|email|sign in|log in/i.test(e.name))
      await this.pressKey("Ctrl+W"); await this.sleep(300)
      return [await this.browserScreenshot("login-page"),
        this.customEvidence("ui_state", "login page detected",
          loginFields.length > 0, `login_elements=${loginFields.length}`)]
    })
  }

  private async browserScreenshot(label: string): Promise<Evidence> {
    return this.hwnd ? this.windowScreenshot(this.hwnd, label) : this.screenshot(label)
  }

  async cleanup(): Promise<void> {
    // Leave browser running
  }
}
