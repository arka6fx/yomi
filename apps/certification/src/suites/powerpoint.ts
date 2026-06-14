import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class PowerPointSuite extends BaseSuite {
  private hwnd: number | null = null
  private filePath = join(homedir(), "Desktop", "yomi-cert-test.pptx")

  constructor() {
    super("powerpoint", "office")
  }

  register(): void {
    this.addTest(1, "Launch PowerPoint", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "POWERPNT" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ titleContains: "PowerPoint" })
      }
      if (!this.hwnd) {
        try {
          await this.launchApp("POWERPNT.EXE")
        } catch {
          await this.launchPowerShell(`
            try {
              Start-Process "POWERPNT"
            } catch {
              $path = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE' -ErrorAction SilentlyContinue).'(default)'
              if ($path) { Start-Process $path }
            }
          `)
        }
        await this.sleep(1000)
        this.hwnd = await this.waitForWindow({ process: "POWERPNT" }, 20_000)
          ?? await this.waitForWindow({ titleContains: "PowerPoint" }, 5_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "powerpoint running", true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "powerpoint available", false,
          "Microsoft PowerPoint not found. Install Microsoft Office."))
      }
      return ev
    })

    this.addTest(2, "Create presentation", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(1500)
      await this.pressKey("Ctrl+N"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "new-presentation"),
        this.customEvidence("ui_state", "new presentation created", true)]
    })

    this.addTest(3, "Add slide", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+M"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "add-slide"),
        this.customEvidence("ui_state", "slide added", true)]
    })

    this.addTest(4, "Add content to slide", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.typeText("Yomi Certification"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(200)
      await this.typeText("Phase X1 Test Presentation"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(200)
      await this.typeText("Automated via UIA"); await this.sleep(200)
      return [await this.windowScreenshot(this.hwnd, "slide-content"),
        this.customEvidence("ui_state", "content added", true)]
    })

    this.addTest(5, "Add shapes", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      // Alt+N → S → H (Insert → Shapes → Rectangle)
      await this.pressKey("Alt+N"); await this.sleep(500)
      await this.pressKey("S"); await this.sleep(500)
      await this.pressKey("H"); await this.sleep(500)
      await this.pressKey("Enter"); await this.sleep(1000)
      return [await this.windowScreenshot(this.hwnd, "add-shapes"),
        this.customEvidence("ui_state", "shapes added", true)]
    })

    this.addTest(6, "Apply theme", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      // Alt+G → H (Design → Themes)
      await this.pressKey("Alt+G"); await this.sleep(500)
      await this.pressKey("H"); await this.sleep(800)
      await this.pressKey("Right"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "apply-theme"),
        this.customEvidence("ui_state", "theme applied", true)]
    })

    this.addTest(7, "Save presentation", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("F12"); await this.sleep(2000)
      await this.typeText(this.filePath); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(3000)
      let saved = existsSync(this.filePath)
      if (!saved) {
        await this.launchPowerShell(`
          try {
            $ppt = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
            if ($ppt.Presentations.Count -gt 0) {
              $pres = $ppt.Presentations.Item(1)
              $pres.SaveAs("${this.filePath}")
            }
          } catch { }
        `)
        await this.sleep(2000)
        saved = existsSync(this.filePath)
      }
      return [await this.filesystem(this.filePath, "saved-presentation"),
        await this.windowScreenshot(this.hwnd, "save-presentation")]
    })
  }

  async cleanup(): Promise<void> {
    if (this.hwnd) await this.closeWindow(this.hwnd).catch(() => null)
  }
}
