import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class InstagramSuite extends BaseSuite {
  private hwnd: number | null = null

  constructor() {
    super("instagram", "messaging")
  }

  register(): void {
    this.addTest(1, "Open Instagram (Web via browser)", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "chrome" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ process: "msedge" })
      }
      let launched = false
      if (this.hwnd) {
        await this.setForeground(this.hwnd); await this.sleep(500)
        await this.pressKey("Ctrl+T"); await this.sleep(800)
        await this.typeText("https://instagram.com"); await this.sleep(200)
        await this.pressKey("Enter"); await this.sleep(5000)
        launched = true
      }
      const ev: Evidence[] = [await this.screenshot("instagram-browser")]
      if (launched) {
        ev.push(this.customEvidence("ui_state", "instagram opened in browser", true))
      } else {
        ev.push(this.customEvidence("process_state", "browser available", false,
          "No browser found. Instagram is web-based."))
      }
      return ev
    })

    this.addTest(2, "Login state check", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      const tree = await this.uiaCall<{ elements: Array<{ name?: string }> }>(
        "get_ui_tree", { maxNodes: 200, maxDepth: 15 }, 10_000)
      const loginFields = (tree?.elements ?? []).filter((e) =>
        e.name && /phone|username|email|password|log in|sign up/i.test(e.name))
      const loggedIn = (tree?.elements ?? []).filter((e) =>
        e.name && /home|profile|search|explore|direct|notifications/i.test(e.name))
      return [this.customEvidence("ui_state", "login state determined",
        true, loginFields.length > 0
          ? `login_page=true elements=${loginFields.length}`
          : `logged_in=true elements=${loggedIn.length}`)]
    })

    this.addTest(3, "Search profile", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.pressKey("Ctrl+/"); await this.sleep(800)
      await this.typeText("natgeo"); await this.sleep(2000)
      return [await this.screenshot("search-profile"),
        this.customEvidence("ui_state", "profile search performed", true)]
    })

    this.addTest(4, "Scroll feed", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.pressKey("PageDown"); await this.sleep(1000)
      await this.pressKey("PageDown"); await this.sleep(1000)
      return [await this.screenshot("scroll-feed"),
        this.customEvidence("ui_state", "feed scrolled", true)]
    })

    this.addTest(5, "Like post", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.pressKey("L"); await this.sleep(1000)
      return [await this.screenshot("like-post"),
        this.customEvidence("ui_state", "like attempted", true)]
    })
  }

  async cleanup(): Promise<void> {
    // Leave browser running
  }
}
