export type CertificationStatus = "certified" | "not_verified" | "degraded" | "failing" | "pending" | "skipped"

export type TestVerdict = "pass" | "fail" | "skip" | "error"

export type AppCategory =
  | "messaging"
  | "music"
  | "system"
  | "file_management"
  | "office"
  | "browser"
  | "development"
  | "terminal"
  | "media"
  | "system_controls"

export type EvidenceKind =
  | "screenshot"
  | "ui_tree"
  | "ui_state"
  | "clipboard"
  | "process_state"
  | "audio_state"
  | "filesystem"
  | "network_state"
  | "human_verification"

export interface Evidence {
  kind: EvidenceKind
  label: string
  passed: boolean
  detail?: string
  artifactPath?: string
}

export interface TestResult {
  id: number
  name: string
  status: TestVerdict
  duration: number
  evidence: Evidence[]
  error?: string
  startTime: string
  executions?: number
}

export interface SuiteResult {
  app: string
  category: AppCategory
  startedAt: string
  completedAt: string
  duration: number
  tests: TestResult[]
  status: CertificationStatus
  summary: {
    total: number
    passed: number
    failed: number
    skipped: number
    errors: number
    successRate: number
    meetsThreshold: boolean
  }
}

export interface CertificationReport {
  phase: string
  generatedAt: string
  platform: string
  hostname: string
  suites: SuiteResult[]
  summary: {
    total: number
    certified: number
    notVerified: number
    degraded: number
    failing: number
    pending: number
    overallRate: number
  }
}

export interface TestDefinition {
  id: number
  name: string
  timeout: number
  fn: () => Promise<Evidence[]>
  executions?: number
}

export interface CertifyOptions {
  apps?: string[]
  all?: boolean
  output?: string
  verbose?: boolean
  autoconfirm?: boolean
  skipIfUnavailable?: boolean
}
