import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class TerminalSuite extends BaseSuite {
  constructor() {
    super("terminal", "terminal")
  }

  register(): void {
    this.addTest(1, "PowerShell available", 15_000, async () => {
      const ev: Evidence[] = []
      const tmp = join(process.env.TEMP || "/tmp", "yomi-powershell-check.txt")
      await this.launchPowerShell(`'YomiCertified' | Out-File "${tmp}" -Encoding UTF8`)
      await this.sleep(1000)
      const available = existsSync(tmp)
      if (available) {
        const content = readFileSync(tmp, "utf-8").trim()
        ev.push(this.customEvidence("filesystem", "powershell output",
          content === "YomiCertified", `content="${content}"`))
      } else {
        ev.push(this.customEvidence("filesystem", "powershell available", false,
          "powershell not responding"))
      }
      return ev
    })

    this.addTest(2, "Run command and capture output", 15_000, async () => {
      const ev: Evidence[] = []
      const tmp = join(process.env.TEMP || "/tmp", "yomi-command-output.txt")
      await this.launchPowerShell(`Get-Date | Out-File "${tmp}" -Encoding UTF8`)
      await this.sleep(1000)
      const exists = existsSync(tmp)
      if (exists) {
        const content = readFileSync(tmp, "utf-8").trim()
        ev.push(this.customEvidence("filesystem", "command output captured",
          content.length > 0, `output="${content.slice(0, 100)}"`))
      } else {
        ev.push(this.customEvidence("filesystem", "command output", false))
      }
      return ev
    })

    this.addTest(3, "Create file via command line", 10_000, async () => {
      const ev: Evidence[] = []
      const testFile = join(process.env.TEMP || "/tmp", "yomi-cert-test.txt")
      await this.launchPowerShell(`New-Item -Path "${testFile}" -ItemType File -Force > $null`)
      await this.sleep(500)
      ev.push(await this.filesystem(testFile, "file-created"))
      return ev
    })

    this.addTest(4, "Delete file via command line", 10_000, async () => {
      const ev: Evidence[] = []
      const testFile = join(process.env.TEMP || "/tmp", "yomi-cert-test.txt")
      await this.launchPowerShell(`Remove-Item -Path "${testFile}" -Force -ErrorAction SilentlyContinue`)
      await this.sleep(500)
      const exists = existsSync(testFile)
      ev.push(this.customEvidence("filesystem", "file-deleted", !exists, `exists=${exists}`))
      return ev
    })

    this.addTest(5, "Navigate directories via PowerShell", 10_000, async () => {
      const ev: Evidence[] = []
      const tmp = join(process.env.TEMP || "/tmp", "yomi-pwd.txt")
      await this.launchPowerShell(`
        Set-Location $env:USERPROFILE\\Desktop
        Get-Location | Select-Object -ExpandProperty Path | Out-File "${tmp}" -Encoding UTF8
      `)
      await this.sleep(1000)
      const exists = existsSync(tmp)
      if (exists) {
        const path = readFileSync(tmp, "utf-8").trim()
        ev.push(this.customEvidence("filesystem", "current directory",
          path.includes("Desktop"), `path="${path}"`))
      } else {
        ev.push(this.customEvidence("filesystem", "current directory", false))
      }
      return ev
    })
  }
}
