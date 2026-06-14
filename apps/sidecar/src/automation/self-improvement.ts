import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ValidationResult } from "./capability-validation.js"

export type SuccessfulStrategy = {
  task: string
  strategy: string
  successRate: number
  evidenceLabels: string[]
  updatedAt: string
}

function strategyPath(): string {
  return process.env.YOMI_SUCCESSFUL_STRATEGIES || join(homedir(), ".yomi", "successful_strategy.json")
}

export function failureAnalysisMarkdown(result: ValidationResult): string {
  const failedEvidence = result.evidence.filter((item) => !item.passed)
  const passedEvidence = result.evidence.filter((item) => item.passed)
  return [
    `# Failure Analysis: ${result.capability}`,
    "",
    `Status: ${result.status}`,
    `Duration: ${result.durationMs}ms`,
    `Root cause: ${result.error ?? failedEvidence[0]?.label ?? "unknown"}`,
    "",
    "## Failed Evidence",
    failedEvidence.length ? failedEvidence.map((item) => `- ${item.kind}: ${item.label}${item.detail ? ` (${item.detail})` : ""}`).join("\n") : "- none",
    "",
    "## Passed Evidence",
    passedEvidence.length ? passedEvidence.map((item) => `- ${item.kind}: ${item.label}${item.detail ? ` (${item.detail})` : ""}`).join("\n") : "- none",
    "",
    "## Recovery Attempts",
    result.recoveryAttempts?.length ? result.recoveryAttempts.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## Suggested Fixes",
    suggestFixes(result).map((item) => `- ${item}`).join("\n"),
    "",
  ].join("\n")
}

export function writeFailureAnalysis(result: ValidationResult, dir: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "failure_analysis.md")
  writeFileSync(path, failureAnalysisMarkdown(result), "utf8")
  return path
}

export function suggestFixes(result: ValidationResult): string[] {
  const labels = result.evidence.filter((item) => !item.passed).map((item) => item.label.toLowerCase())
  const fixes: string[] = []
  if (labels.some((label) => label.includes("exists"))) fixes.push("Verify the save path and add independent filesystem polling after save.")
  if (labels.some((label) => label.includes("window"))) fixes.push("Re-snapshot foreground UI and handle modal/backstage prompts before acting.")
  if (labels.some((label) => label.includes("readable"))) fixes.push("Open the produced artifact with a parser or app-specific readback before marking success.")
  if (!fixes.length) fixes.push("Capture screenshot, UI tree, action request, and retry with a slower validated strategy.")
  return fixes
}

export function recordSuccessfulStrategy(strategy: Omit<SuccessfulStrategy, "updatedAt">): void {
  const path = strategyPath()
  if (path === ":memory:") return
  mkdirSync(dirname(path), { recursive: true })
  const existing = readStrategies(path).filter((item) => item.task !== strategy.task)
  existing.unshift({ ...strategy, updatedAt: new Date().toISOString() })
  writeFileSync(path, JSON.stringify(existing.slice(0, 100), null, 2), "utf8")
}

export function readStrategies(path = strategyPath()): SuccessfulStrategy[] {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))
    return Array.isArray(value) ? value as SuccessfulStrategy[] : []
  } catch {
    return []
  }
}
