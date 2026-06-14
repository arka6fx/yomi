import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type CapabilityStatus = "unknown" | "unverified" | "verified" | "degraded" | "failing" | "blocked"
export type EvidenceKind = "filesystem" | "ui_state" | "screenshot" | "audio_state" | "process_state" | "network_state" | "human_required"
export type ValidationStatus = "pass" | "fail" | "blocked"

export type CapabilityRecord = {
  capability: string
  category: string
  status: CapabilityStatus
  successRate: number
  confidence: number
  lastTested?: string
  lastEvidence?: Evidence[]
  knownFailures: string[]
  testCount: number
  passCount: number
}

export type Evidence = {
  kind: EvidenceKind
  label: string
  passed: boolean
  detail?: string
  artifactPath?: string
}

export type ValidationResult = {
  capability: string
  status: ValidationStatus
  evidence: Evidence[]
  error?: string
  durationMs: number
  recoveryAttempts?: string[]
}

export type CapabilityTest = {
  capability: string
  category: string
  execute: () => Promise<unknown>
  validate: (execution: unknown) => Promise<Evidence[]>
  analyzeFailure?: (result: ValidationResult) => Promise<string>
  repair?: (result: ValidationResult) => Promise<boolean>
  maxRepairAttempts?: number
}

export type CoverageDashboardItem = CapabilityRecord & {
  coverageScore: number
  priorityScore: number
  priorityReason: string
}

export type CoverageDashboard = {
  generatedAt: string
  totalCapabilities: number
  verifiedCapabilities: number
  averageCoverage: number
  weakest: CoverageDashboardItem[]
  capabilities: CoverageDashboardItem[]
}

function registryPath(): string {
  return process.env.YOMI_CAPABILITY_REGISTRY || join(homedir(), ".yomi", "capability_registry.json")
}

function emptyRecord(capability: string, category: string): CapabilityRecord {
  return {
    capability,
    category,
    status: "unverified",
    successRate: 0,
    confidence: 0,
    knownFailures: [],
    testCount: 0,
    passCount: 0,
  }
}

export class CapabilityRegistry {
  private records = new Map<string, CapabilityRecord>()

  constructor(private readonly path = registryPath()) {
    this.load()
  }

  register(capability: string, category: string): CapabilityRecord {
    const existing = this.records.get(capability)
    if (existing) return existing
    const record = emptyRecord(capability, category)
    this.records.set(capability, record)
    this.save()
    return record
  }

  recordResult(result: ValidationResult, category = "unknown"): CapabilityRecord {
    const current = this.records.get(result.capability) ?? emptyRecord(result.capability, category)
    const passed = result.status === "pass"
    const testCount = current.testCount + 1
    const passCount = current.passCount + (passed ? 1 : 0)
    const successRate = testCount === 0 ? 0 : passCount / testCount
    const evidenceQuality = evidenceQualityScore(result.evidence)
    const status: CapabilityStatus = result.status === "blocked"
      ? "blocked"
      : passed && successRate >= 0.95 && evidenceQuality >= 0.8
        ? "verified"
        : passed
          ? "degraded"
          : successRate > 0
            ? "degraded"
            : "failing"
    const knownFailures = result.error && !passed
      ? [result.error, ...current.knownFailures.filter((entry) => entry !== result.error)].slice(0, 10)
      : current.knownFailures
    const updated: CapabilityRecord = {
      ...current,
      category: current.category === "unknown" ? category : current.category,
      status,
      successRate,
      confidence: Math.min(1, evidenceQuality * Math.min(1, testCount / 5)),
      lastTested: new Date().toISOString(),
      lastEvidence: result.evidence,
      knownFailures,
      testCount,
      passCount,
    }
    this.records.set(result.capability, updated)
    this.save()
    return updated
  }

  list(): CapabilityRecord[] {
    return [...this.records.values()].sort((a, b) => a.capability.localeCompare(b.capability))
  }

  dashboard(limit = 10): CoverageDashboard {
    return buildCoverageDashboard(this.list(), limit)
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as { capabilities?: CapabilityRecord[] } | CapabilityRecord[]
      const records = Array.isArray(raw) ? raw : raw.capabilities ?? []
      for (const record of records) this.records.set(record.capability, record)
    } catch {
      this.records.clear()
    }
  }

  private save(): void {
    if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true })
    if (this.path === ":memory:") return
    writeFileSync(this.path, JSON.stringify({ capabilities: this.list() }, null, 2), "utf8")
  }
}

export function evidenceQualityScore(evidence: Evidence[]): number {
  if (!evidence.length) return 0
  const objective = evidence.filter((item) => item.kind !== "human_required")
  const passed = objective.filter((item) => item.passed)
  if (!objective.length) return 0
  return passed.length / objective.length
}

export function hasObjectivePassingEvidence(evidence: Evidence[]): boolean {
  return evidence.some((item) => item.kind !== "human_required" && item.passed)
}

export async function runCapabilityValidation(test: CapabilityTest, registry = new CapabilityRegistry()): Promise<ValidationResult> {
  registry.register(test.capability, test.category)
  const started = Date.now()
  const recoveryAttempts: string[] = []
  let execution: unknown
  try {
    execution = await test.execute()
  } catch (error) {
    const result = resultFromError(test.capability, error, Date.now() - started, recoveryAttempts)
    registry.recordResult(result, test.category)
    return result
  }

  let result = await validateExecution(test, execution, Date.now() - started, recoveryAttempts)
  let attempts = 0
  while (result.status !== "pass" && test.repair && attempts < (test.maxRepairAttempts ?? 1)) {
    attempts++
    recoveryAttempts.push(`repair attempt ${attempts}`)
    const repaired = await test.repair(result)
    if (!repaired) break
    execution = await test.execute()
    result = await validateExecution(test, execution, Date.now() - started, recoveryAttempts)
  }
  registry.recordResult(result, test.category)
  return result
}

async function validateExecution(
  test: CapabilityTest,
  execution: unknown,
  durationMs: number,
  recoveryAttempts: string[],
): Promise<ValidationResult> {
  try {
    const evidence = await test.validate(execution)
    const objectivePass = hasObjectivePassingEvidence(evidence)
    const allObjectiveEvidencePassed = evidence.filter((item) => item.kind !== "human_required").every((item) => item.passed)
    const blocked = evidence.some((item) => item.kind === "human_required" && !item.passed)
    const status: ValidationStatus = blocked ? "blocked" : objectivePass && allObjectiveEvidencePassed ? "pass" : "fail"
    const result: ValidationResult = {
      capability: test.capability,
      status,
      evidence,
      durationMs,
      recoveryAttempts,
      ...(status === "fail" ? { error: "objective validation failed" } : {}),
    }
    return result.status === "fail" && test.analyzeFailure
      ? { ...result, error: await test.analyzeFailure(result) }
      : result
  } catch (error) {
    return resultFromError(test.capability, error, durationMs, recoveryAttempts)
  }
}

function resultFromError(capability: string, error: unknown, durationMs: number, recoveryAttempts: string[]): ValidationResult {
  return {
    capability,
    status: "fail",
    evidence: [],
    error: error instanceof Error ? error.message : String(error),
    durationMs,
    recoveryAttempts,
  }
}

export function buildCoverageDashboard(records: CapabilityRecord[], limit = 10): CoverageDashboard {
  const capabilities = records.map((record) => {
    const coverageScore = Math.round((record.successRate * 0.65 + record.confidence * 0.35) * 100)
    const stalePenalty = record.lastTested && Date.now() - Date.parse(record.lastTested) < 7 * 24 * 60 * 60 * 1000 ? 0 : 20
    const failurePenalty = Math.min(30, record.knownFailures.length * 8)
    const priorityScore = Math.max(0, 100 - coverageScore + stalePenalty + failurePenalty)
    const priorityReason = record.status === "verified"
      ? "healthy"
      : record.status === "blocked"
        ? "blocked by human-required condition"
        : record.knownFailures[0] ?? "low confidence or insufficient recent evidence"
    return { ...record, coverageScore, priorityScore, priorityReason }
  }).sort((a, b) => b.priorityScore - a.priorityScore || a.coverageScore - b.coverageScore)
  const averageCoverage = capabilities.length
    ? Math.round(capabilities.reduce((sum, item) => sum + item.coverageScore, 0) / capabilities.length)
    : 0
  return {
    generatedAt: new Date().toISOString(),
    totalCapabilities: capabilities.length,
    verifiedCapabilities: capabilities.filter((item) => item.status === "verified").length,
    averageCoverage,
    weakest: capabilities.slice(0, limit),
    capabilities,
  }
}

export function renderCoverageDashboardMarkdown(dashboard: CoverageDashboard): string {
  const rows = dashboard.capabilities.map((item) => (
    `| ${item.capability} | ${item.category} | ${item.status} | ${item.coverageScore}% | ${Math.round(item.successRate * 100)}% | ${item.priorityScore} | ${item.priorityReason} |`
  ))
  return [
    "# Capability Coverage Dashboard",
    "",
    `Generated: ${dashboard.generatedAt}`,
    `Capabilities: ${dashboard.totalCapabilities}`,
    `Verified: ${dashboard.verifiedCapabilities}`,
    `Average coverage: ${dashboard.averageCoverage}%`,
    "",
    "## Priority Queue",
    ...dashboard.weakest.map((item, index) => `${index + 1}. ${item.capability} — ${item.coverageScore}% coverage, priority ${item.priorityScore}: ${item.priorityReason}`),
    "",
    "## Full Matrix",
    "| Capability | Category | Status | Coverage | Success | Priority | Reason |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n")
}
