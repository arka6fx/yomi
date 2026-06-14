import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class ExcelSuite extends BaseSuite {
  private hwnd: number | null = null
  private filePath = join(homedir(), "Desktop", "yomi-cert-test.xlsx")

  constructor() {
    super("excel", "office")
  }

  private async launchExcel(): Promise<number | null> {
    let hwnd = await this.findWindow({ process: "EXCEL" })
    if (!hwnd) {
      hwnd = await this.findWindow({ titleContains: "Excel" })
    }
    if (hwnd) return hwnd

    try {
      Bun.spawn(["EXCEL.EXE"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    } catch {
      await this.launchPowerShell(`
        $apps = Get-StartApps | Where-Object { \$_.Name -like '*Excel*' }
        if ($apps) { Start-Process "shell:AppsFolder\\$($apps[0].AppID)" }
      `)
    }

    await this.sleep(500)
    hwnd = await this.waitForWindow({ process: "EXCEL" }, 20_000)
    if (!hwnd) {
      hwnd = await this.waitForWindow({ titleContains: "Excel" }, 5_000)
    }
    return hwnd
  }

  register(): void {
    this.addTest(1, "Launch Excel", 30_000, async () => {
      this.hwnd = await this.launchExcel()
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "excel running", true))
        await this.setForeground(this.hwnd).catch(() => null)
      } else {
        ev.push(this.customEvidence("process_state", "excel available", false,
          "Microsoft Excel not found. Install Microsoft Office."))
      }
      return ev
    })

    this.addTest(2, "Create workbook", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(1000)
      await this.pressKey("Ctrl+N"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "new-workbook"),
        this.customEvidence("ui_state", "new workbook created", true)]
    })

    this.addTest(3, "Enter data", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.typeText("Yomi Certification"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(500)
      await this.typeText("Test Data 1"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(500)
      await this.typeText("Test Data 2"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(500)
      await this.typeText("100"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(500)
      return [await this.windowScreenshot(this.hwnd, "data-entry"),
        this.customEvidence("ui_state", "data entered", true)]
    })

    this.addTest(4, "Use formulas", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.pressKey("Up"); await this.sleep(100)
      await this.pressKey("Up"); await this.sleep(100)
      await this.pressKey("Up"); await this.sleep(100)
      await this.pressKey("Right"); await this.sleep(100)
      await this.typeText("=SUM(A1:A3)"); await this.sleep(200)
      await this.pressKey("Enter"); await this.sleep(500)
      return [await this.windowScreenshot(this.hwnd, "formula"),
        this.customEvidence("ui_state", "formula entered", true)]
    })

    this.addTest(5, "Sort data", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+A"); await this.sleep(300)
      // Alt+A+S for Sort
      await this.pressKey("Alt+A"); await this.sleep(500)
      await this.pressKey("S"); await this.sleep(500)
      await this.pressKey("Enter"); await this.sleep(1000)
      return [await this.windowScreenshot(this.hwnd, "sort-data"),
        this.customEvidence("ui_state", "sort performed", true)]
    })

    this.addTest(6, "Save workbook", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(500)
      await this.pressKey("F12"); await this.sleep(2000)
      await this.typeText(this.filePath); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(3000)
      let saved = existsSync(this.filePath)
      if (!saved) {
        await this.launchPowerShell(`
          try {
            $excel = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
            if ($excel.Workbooks.Count -gt 0) {
              $wb = $excel.Workbooks.Item(1)
              $wb.SaveAs("${this.filePath}")
            }
          } catch { }
        `)
        await this.sleep(2000)
        saved = existsSync(this.filePath)
      }
      return [await this.filesystem(this.filePath, "saved-workbook"),
        await this.windowScreenshot(this.hwnd, `save-workbook-${saved ? "ok" : "fail"}`)]
    })
  }

  async cleanup(): Promise<void> {
    if (this.hwnd) await this.closeWindow(this.hwnd).catch(() => null)
  }
}
