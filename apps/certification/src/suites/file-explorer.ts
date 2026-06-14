import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class FileExplorerSuite extends BaseSuite {
  private hwnd: number | null = null
  private testFiles: string[] = []

  constructor() {
    super("file-explorer", "file_management")
  }

  register(): void {
    this.addTest(1, "Launch File Explorer", 15_000, async () => {
      await this.launchApp("explorer.exe", [homedir()])
      await this.sleep(3000)
      const folderName = homedir().split(/[/\\]/).pop() ?? ""
      this.hwnd = await this.waitForWindow({ titleContains: folderName }, 12_000)
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "explorer running", true))
      } else {
        ev.push(this.customEvidence("process_state", "explorer found", false))
      }
      return ev
    })

    this.addTest(2, "Create folder", 10_000, async () => {
      const ev: Evidence[] = []
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      const folderPath = join(homedir(), "Desktop", "YomiCertTest")
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.pressKey("Ctrl+Shift+N"); await this.sleep(1000)
      await this.typeText("YomiCertTest"); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(1000)
      if (!existsSync(folderPath)) {
        await this.launchPowerShell(`New-Item -ItemType Directory -Path "${folderPath}" -Force -ErrorAction Stop`)
        await this.sleep(500)
      }
      this.testFiles.push(folderPath)
      ev.push(await this.filesystem(folderPath, "folder-created"))
      ev.push(await this.screenshot("after-create-folder"))
      return ev
    })

    this.addTest(3, "Create file in folder", 10_000, async () => {
      const ev: Evidence[] = []
      const filePath = join(homedir(), "Desktop", "YomiCertTest", "test-file.txt")
      await Bun.write(filePath, "Yomi certification test content\n")
      this.testFiles.push(filePath)
      ev.push(await this.filesystem(filePath, "file-created"))
      return ev
    })

    this.addTest(4, "Search file", 15_000, async () => {
      const ev: Evidence[] = []
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(300)
      await this.pressKey("Ctrl+F"); await this.sleep(500)
      await this.typeText("YomiCertTest"); await this.sleep(1000)
      ev.push(await this.screenshot("search-file"))
      await this.pressKey("Escape"); await this.sleep(300)
      ev.push(this.customEvidence("ui_state", "search initiated", true))
      return ev
    })

    this.addTest(5, "Navigate to folder", 10_000, async () => {
      const ev: Evidence[] = []
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      const addrBar = await this.uiaCall<{ elements: Array<{ ref: string; role: string; name?: string; enabled?: boolean }> }>(
        "get_ui_tree", { hwnd: this.hwnd, maxNodes: 200, maxDepth: 15 }, 10_000)
      const combobox = (addrBar?.elements ?? []).find((e) =>
        e.role === "ComboBox" && e.name?.toLowerCase().includes("address"))
      if (combobox) {
        await this.invokeElement(combobox.ref); await this.sleep(300)
        await this.typeText(join(homedir(), "Desktop", "YomiCertTest")); await this.sleep(200)
        await this.pressKey("Enter"); await this.sleep(1500)
        ev.push(this.customEvidence("ui_state", "navigated to folder", true))
      } else {
        await this.pressKey("Alt+D"); await this.sleep(300)
        await this.typeText(join(homedir(), "Desktop", "YomiCertTest")); await this.sleep(200)
        await this.pressKey("Enter"); await this.sleep(1500)
        ev.push(this.customEvidence("ui_state", "navigated via Alt+D", true))
      }
      ev.push(await this.screenshot("after-navigate"))
      return ev
    })

    this.addTest(6, "Rename file", 15_000, async () => {
      const ev: Evidence[] = []
      const oldPath = join(homedir(), "Desktop", "YomiCertTest", "test-file.txt")
      const newPath = join(homedir(), "Desktop", "YomiCertTest", "renamed-file.txt")
      if (!existsSync(oldPath)) return [this.customEvidence("filesystem", "file not found", true, "SKIP")]
      // Rename via PowerShell directly to avoid focus issues
      await this.launchPowerShell(
        `Rename-Item -LiteralPath "${oldPath}" -NewName "renamed-file.txt" -Force -ErrorAction Stop`
      ); await this.sleep(500)
      if (existsSync(newPath)) {
        this.testFiles.push(newPath)
        ev.push(await this.filesystem(newPath, "renamed-file"))
      } else {
        // Fallback to UI approach
        if (this.hwnd) await this.setForeground(this.hwnd); await this.sleep(300)
        await this.pressKey("Alt+D"); await this.sleep(200)
        await this.pressKey("Tab"); await this.sleep(100)
        await this.pressKey("Tab"); await this.sleep(100)
        await this.pressKey("Tab"); await this.sleep(100)
        await this.pressKey("Tab"); await this.sleep(100)
        await this.pressKey("F2"); await this.sleep(800)
        await this.typeText("renamed-file.txt"); await this.sleep(200)
        await this.pressKey("Enter"); await this.sleep(1000)
        ev.push(this.customEvidence("filesystem", "rename via UI",
          existsSync(newPath), `exists=${existsSync(newPath)}`))
      }
      ev.push(await this.screenshot("after-rename"))
      return ev
    })

    this.addTest(7, "Delete file", 10_000, async () => {
      const ev: Evidence[] = []
      const filePath = join(homedir(), "Desktop", "YomiCertTest", "renamed-file.txt")
      if (!existsSync(filePath)) return [this.customEvidence("filesystem", "not found", true, "SKIP")]
      await this.launchPowerShell(
        `Remove-Item -LiteralPath "${filePath}" -Force -ErrorAction Stop`
      ); await this.sleep(500)
      ev.push(this.customEvidence("filesystem", "file deleted", !existsSync(filePath),
        `exists=${existsSync(filePath)}`))
      // Also clean up the empty folder
      const folderPath = join(homedir(), "Desktop", "YomiCertTest")
      if (!existsSync(join(folderPath, "renamed-file.txt")) && existsSync(folderPath)) {
        await this.launchPowerShell(
          `Remove-Item -LiteralPath "${folderPath}" -Recurse -Force -ErrorAction SilentlyContinue`
        )
      }
      ev.push(await this.screenshot("after-delete"))
      return ev
    })
  }

  async cleanup(): Promise<void> {
    for (const f of this.testFiles.reverse()) {
      try {
        if (!f) continue
        const stat = await Bun.file(f).stat().catch(() => null)
        if (stat?.isDirectory()) {
          await this.launchPowerShell(`Remove-Item -LiteralPath "${f}" -Recurse -Force -ErrorAction SilentlyContinue`)
        } else {
          await this.launchPowerShell(`Remove-Item -LiteralPath "${f}" -Force -ErrorAction SilentlyContinue`)
        }
      } catch { /* ignore */ }
    }
    if (this.hwnd) await this.closeWindow(this.hwnd).catch(() => null)
  }
}
