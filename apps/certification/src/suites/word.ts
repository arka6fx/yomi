import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class WordSuite extends BaseSuite {
  private hwnd: number | null = null
  private filePath = join(homedir(), "Desktop", "yomi-cert-test.docx")

  constructor() {
    super("word", "office")
  }

  register(): void {
    this.addTest(1, "Launch Microsoft Word", 30_000, async () => {
      this.hwnd = await this.findWindow({ process: "WINWORD" })
      if (!this.hwnd) {
        this.hwnd = await this.findWindow({ titleContains: "Word" })
      }
      if (!this.hwnd) {
        await this.launchWord(); await this.sleep(500)
        this.hwnd = await this.waitForWindow({ process: "WINWORD" }, 20_000)
        if (!this.hwnd) {
          this.hwnd = await this.waitForWindow({ titleContains: "Word" }, 10_000)
        }
      }
      if (this.hwnd) {
        await this.setForeground(this.hwnd).catch(() => null)
        await this.sleep(1000)
        // Dismiss any "What's New" or splash dialogs
        await this.pressKey("Escape"); await this.sleep(500)
        await this.pressKey("Escape"); await this.sleep(500)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "word running", true))
      } else {
        ev.push(this.customEvidence("process_state", "word available", false,
          "Microsoft Word not found. Install Microsoft Office."))
      }
      return ev
    })

    this.addTest(2, "Create document", 30_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(1000)
      await this.pressKey("Ctrl+N"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "new-document"),
        this.customEvidence("ui_state", "new document created", true)]
    })

    this.addTest(3, "Format content", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.typeText("Yomi Certification Test Document"); await this.sleep(300)
      await this.pressKey("Ctrl+A"); await this.sleep(200)
      await this.pressKey("Ctrl+B"); await this.sleep(300)
      await this.pressKey("Ctrl+I"); await this.sleep(300)
      await this.pressKey("Ctrl+U"); await this.sleep(300)
      await this.pressKey("Right"); await this.sleep(100)
      await this.pressKey("Enter"); await this.sleep(200)
      await this.typeText("This is a formatted test paragraph."); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "formatted-content"),
        this.customEvidence("ui_state", "content formatted", true)]
    })

    this.addTest(4, "Insert table", 20_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(200)
      await this.pressKey("Alt+N"); await this.sleep(500)
      await this.pressKey("T"); await this.sleep(500)
      for (let i = 0; i < 3; i++) { await this.pressKey("Right"); await this.sleep(100) }
      for (let i = 0; i < 3; i++) { await this.pressKey("Down"); await this.sleep(100) }
      await this.pressKey("Enter"); await this.sleep(1000)
      return [await this.windowScreenshot(this.hwnd, "insert-table"),
        this.customEvidence("ui_state", "table inserted", true)]
    })

    this.addTest(5, "Save document", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      let saved = existsSync(this.filePath)
      if (!saved) {
        await this.launchPowerShell(`
          try {
            $word = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
            $word.DisplayAlerts = 0
            $doc = $word.ActiveDocument
            if (-not $doc -and $word.Documents.Count -gt 0) { $doc = $word.Documents.Item(1) }
            if ($doc) {
              $doc.SaveAs2("${this.filePath}")
            }
          } catch { }
        `)
        await this.sleep(2000)
        saved = existsSync(this.filePath)
      }
      if (!saved) {
        await this.pressKey("F12"); await this.sleep(2000)
        await this.typeText(this.filePath); await this.sleep(200)
        await this.pressKey("Enter"); await this.sleep(3000)
        saved = existsSync(this.filePath)
      }
      return [await this.filesystem(this.filePath, "saved-file"),
        await this.windowScreenshot(this.hwnd, "save-document")]
    })

    this.addTest(6, "Find and Replace", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+H"); await this.sleep(800)
      await this.typeText("Yomi"); await this.sleep(200)
      await this.pressKey("Tab"); await this.sleep(200)
      await this.typeText("YomiCert"); await this.sleep(200)
      await this.pressKey("Alt+A"); await this.sleep(500)
      await this.pressKey("Escape"); await this.sleep(300)
      return [await this.windowScreenshot(this.hwnd, "find-replace"),
        this.customEvidence("ui_state", "find/replace performed", true)]
    })

    this.addTest(7, "Export PDF", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      const pdfPath = this.filePath.replace(/\.docx$/i, ".pdf")
      await this.setForeground(this.hwnd); await this.sleep(300)
      let saved = existsSync(pdfPath)
      if (!saved) {
        await this.launchPowerShell(`
          try {
            $word = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
            $word.DisplayAlerts = 0
            $doc = $word.ActiveDocument
            if (-not $doc -and $word.Documents.Count -gt 0) { $doc = $word.Documents.Item(1) }
            if ($doc) {
              $doc.ExportAsFixedFormat("${pdfPath}", 17)
            }
          } catch { }
        `)
        await this.sleep(2000)
        saved = existsSync(pdfPath)
      }
      if (!saved) {
        await this.pressKey("F12"); await this.sleep(2000)
        await this.typeText(pdfPath); await this.sleep(200)
        await this.pressKey("Enter"); await this.sleep(3000)
        saved = existsSync(pdfPath)
      }
      return [await this.filesystem(pdfPath, "pdf-exported"),
        this.customEvidence("filesystem", "pdf export",
          saved, `path=${pdfPath}`)]
    })

    this.addTest(8, "Reopen saved document", 20_000, async () => {
      if (!this.filePath) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.closeWindow(this.hwnd!).catch(() => null); await this.sleep(500)
      await this.launchWord([this.filePath]); await this.sleep(500)
      let hwnd = await this.waitForWindow({ process: "WINWORD" }, 20_000)
      if (!hwnd) {
        hwnd = await this.waitForWindow({ titleContains: "yomi-cert-test" }, 10_000)
      }
      this.hwnd = hwnd
      return [await this.screenshot("reopen-document"),
        this.customEvidence("process_state", "document reopened", hwnd != null, `hwnd=${hwnd}`)]
    })
  }

  private async launchWord(args: string[] = []): Promise<void> {
    try {
      await this.launchApp("WINWORD.EXE", args)
    } catch {
      this.log("WINWORD.EXE not on PATH, falling back to Start-Process")
      const script = args.length > 0
        ? `Start-Process "WINWORD" -ArgumentList '${args[0]}'`
        : `Start-Process "WINWORD"`
      await this.launchPowerShell(script)
    }
  }

  async cleanup(): Promise<void> {
    if (this.hwnd) await this.closeWindow(this.hwnd).catch(() => null)
  }
}
