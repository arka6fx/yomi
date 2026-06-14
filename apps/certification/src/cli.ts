#!/usr/bin/env bun
import { platform } from "node:os"
import { CertificationRunner } from "./runner.js"
import { registerAllSuites } from "./suites/index.js"
import type { CertifyOptions } from "./types.js"

async function main() {
  if (platform() !== "win32") {
    console.error("Phase X1 certification requires Windows (UIA automation)")
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const opts: CertifyOptions = {
    apps: [],
    all: false,
    output: undefined,
    verbose: args.includes("--verbose") || args.includes("-v"),
    autoconfirm: process.env.YOMI_ACT_AUTOCONFIRM === "true",
    skipIfUnavailable: true,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--all" || arg === "-a") {
      opts.all = true
    } else if (arg === "--app" && i + 1 < args.length) {
      opts.apps!.push(args[++i]!)
    } else if (arg === "--output" && i + 1 < args.length) {
      opts.output = args[++i]
    } else if (arg === "--autoconfirm") {
      opts.autoconfirm = true
      process.env.YOMI_ACT_AUTOCONFIRM = "true"
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      return
    }
  }

  const runner = new CertificationRunner()
  const suites = registerAllSuites()
  for (const suite of suites) {
    runner.register(suite)
  }

  if (!opts.all && opts.apps?.length === 0) {
    opts.all = true
  }

  const validApps = opts.all ? runner.listApps() : opts.apps!.filter((a) => runner.listApps().includes(a))
  const invalidApps = opts.all ? [] : opts.apps!.filter((a) => !runner.listApps().includes(a))

  if (invalidApps.length > 0) {
    console.warn("Unknown apps:", invalidApps.join(", "))
    console.warn("Available:", runner.listApps().join(", "))
  }

  if (validApps.length === 0) {
    console.error("No valid apps selected.")
    printHelp()
    process.exit(1)
  }

  const start = Date.now()
  console.log("=".repeat(60))
  console.log("Phase X1 \u2014 Universal Application Certification Framework")
  console.log("=".repeat(60))
  console.log("Platform: " + platform())
  console.log("Host: " + (process.env.COMPUTERNAME || "unknown"))
  console.log("Apps: " + validApps.join(", "))
  console.log("Autoconfirm: " + opts.autoconfirm)
  console.log()

  const report = await runner.run(opts)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log()
  console.log("=".repeat(60))
  console.log("CERTIFICATION COMPLETE")
  console.log("=".repeat(60))
  console.log()
  console.log("Runtime: " + elapsed + "s")
  console.log("Total suites: " + report.summary.total)
  console.log("Certified: " + report.summary.certified)
  console.log("Not verified: " + report.summary.notVerified)
  console.log("Degraded: " + report.summary.degraded)
  console.log("Failing: " + report.summary.failing)
  console.log("Pending: " + report.summary.pending)
  console.log("Overall rate: " + report.summary.overallRate + "%")
  console.log()

  if (opts.output) {
    console.log("Report saved to: " + opts.output + "/")
  }

  for (const suite of report.suites) {
    const rate = suite.summary.total > 0
      ? Math.round((suite.summary.passed / suite.summary.total) * 100)
      : 0
    const icon = suite.status === "certified" ? "PASS" : suite.status === "degraded" ? "WARN" : "FAIL"
    console.log("  " + icon + " [" + suite.status.toUpperCase() + "] " + suite.app + ": " + suite.summary.passed + "/" + suite.summary.total + " (" + rate + "%) " + suite.duration + "ms")
  }

  console.log()

  const allCertified = report.suites.every((s) => s.summary.total > 0 && s.summary.successRate >= 95)
  process.exit(allCertified ? 0 : 1)
}

function printHelp() {
  console.log("Usage: bun run certify [options]")
  console.log("")
  console.log("Options:")
  console.log("  --all, -a              Run all certification suites")
  console.log("  --app <name>           Run specific app suite (can be specified multiple times)")
  console.log("  --output <dir>         Output directory for reports (default: audit/certification)")
  console.log("  --autoconfirm          Auto-confirm risky actions (sets YOMI_ACT_AUTOCONFIRM=true)")
  console.log("  --verbose, -v          Verbose output")
  console.log("  --help, -h             Show this help")
  console.log("")
  console.log("Examples:")
  console.log("  bun run certify:all                    Run all certification suites")
  console.log("  bun run certify:spotify                Run Spotify certification only")
  console.log("  bun run certify:notepad                Run Notepad certification only")
  console.log("  bun run certify --app spotify --app notepad --app media")
}

main().catch((e) => {
  console.error("Fatal: " + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
