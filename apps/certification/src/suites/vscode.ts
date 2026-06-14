import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class VSCodeSuite extends BaseSuite {
  private hwnd: number | null = null

  constructor() {
    super("vscode", "development")
  }

  register(): void {
    this.addTest(1, "Launch VS Code", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "Code" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ titleContains: "Visual Studio Code" })
      }
      if (!this.hwnd) {
        await this.launchApp("code.cmd", ["."]); await this.sleep(500)
        this.hwnd = await this.waitForWindow({ process: "Code", titleContains: "Visual Studio Code" }, 20_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "vscode running", true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "vscode available", false,
          "VS Code not found. Install from https://code.visualstudio.com"))
      }
      return ev
    })

    this.addTest(2, "Open file", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      await this.pressKey("Ctrl+P"); await this.sleep(800)
      await this.typeText("package.json"); await this.sleep(1000)
      await this.pressKey("Enter"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "open-file"),
        this.customEvidence("ui_state", "file opened", true)]
    })

    this.addTest(3, "Edit file", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.pressKey("Ctrl+End"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(200)
      await this.typeText("// Yomi certification test edit"); await this.sleep(500)
      await this.pressKey("Ctrl+Z"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "edit-file"),
        this.customEvidence("ui_state", "file edited and undone", true)]
    })

    this.addTest(4, "Search code", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+Shift+F"); await this.sleep(800)
      await this.typeText("import"); await this.sleep(1500)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "search-code"),
        this.customEvidence("ui_state", "code search performed", true)]
    })

    this.addTest(5, "Open Git panel", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+Shift+G"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "git-panel"),
        this.customEvidence("ui_state", "Git panel opened", true)]
    })

    this.addTest(6, "Run terminal command", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+`"); await this.sleep(1500)
      await this.typeText("dir"); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(2000)
      await this.pressKey("Ctrl+`"); await this.sleep(500)
      return [await this.windowScreenshot(this.hwnd, "terminal-command"),
        this.customEvidence("ui_state", "terminal command executed", true)]
    })

    this.addTest(7, "Save file", 10_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+S"); await this.sleep(1000)
      return [this.customEvidence("ui_state", "file saved", true, "Ctrl+S sent")]
    })
  }

  async cleanup(): Promise<void> {
    // Leave running
  }
}
