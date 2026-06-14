import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { BaseSuite } from "./suite.js"
import type { CertificationReport, CertifyOptions, SuiteResult } from "./types.js"
import { generateReport } from "./report.js"

export class CertificationRunner {
  private suites = new Map<string, BaseSuite>()
  private results: SuiteResult[] = []

  register(suite: BaseSuite): void {
    this.suites.set(suite["app"], suite)
  }

  listApps(): string[] {
    return [...this.suites.keys()]
  }

  async run(opts: CertifyOptions = {}): Promise<CertificationReport> {
    const apps = opts.all
      ? this.listApps()
      : opts.apps?.filter((a) => this.suites.has(a)) ?? []

    if (apps.length === 0) {
      console.warn("No matching suites found. Available:", this.listApps().join(", "))
      return {
        phase: "Phase X1 — Universal Application Certification",
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        hostname: process.env.COMPUTERNAME || "unknown",
        suites: [],
        summary: { total: 0, certified: 0, notVerified: 0, degraded: 0, failing: 0, pending: 0, overallRate: 0 },
      }
    }

    const reportDir = opts.output ?? join(process.cwd(), "audit", "certification")
    mkdirSync(reportDir, { recursive: true })

    for (const app of apps) {
      const suite = this.suites.get(app)
      if (!suite) continue
      console.log(`\n${"=".repeat(60)}`)
      console.log(`Running certification suite: ${app}`)
      console.log(`${"=".repeat(60)}`)
      try {
        const result = await suite.run()
        this.results.push(result)
      } catch (e) {
        console.error(`Suite ${app} crashed:`, e)
      }
    }

    return generateReport(this.results, "Phase X1 — Universal Application Certification", reportDir)
  }
}
