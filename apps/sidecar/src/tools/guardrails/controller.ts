// Per-turn tool-call loop guardrail. Tracks repeated failures and identical idempotent
// results; returns a decision (allow / warn / block / halt) for runtime code to act on.
// Pure: no I/O, no logging. Per-turn state is owned by the controller instance; reset
// at the start of each ReAct burst.
//
// Three triggers:
//   exact failure    — same (toolName, canonicalArgs) failing N times
//   same-tool failure— same toolName failing with any args M times
//   no progress      — idempotent tool returning identical result K times

// Tools whose arguments are typically unique (queries, paths) but the output
// is the same — repeated identical results mean the agent is in a loop.
const IDEMPOTENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read_file",
  "list_files",
  "search",
])

// Tools that mutate state. Listed explicitly so we can default-classify new
// tools as neither idempotent nor mutating (treated as non-idempotent = not
// tracked for no-progress).
const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  "bash",
  "write_file",
  "patch",
  "todo",
  "memory",
  "skill_manage",
  "send_message",
])

export interface ToolCallGuardrailConfig {
  warningsEnabled: boolean
  hardStopEnabled: boolean
  exactFailureWarnAfter: number
  exactFailureBlockAfter: number
  sameToolFailureWarnAfter: number
  sameToolFailureHaltAfter: number
  noProgressWarnAfter: number
  noProgressBlockAfter: number
  idempotentTools: ReadonlySet<string>
  mutatingTools: ReadonlySet<string>
}

export const DEFAULT_GUARDRAIL_CONFIG: ToolCallGuardrailConfig = {
  warningsEnabled: true,
  hardStopEnabled: false,
  exactFailureWarnAfter: 2,
  exactFailureBlockAfter: 5,
  sameToolFailureWarnAfter: 3,
  sameToolFailureHaltAfter: 8,
  noProgressWarnAfter: 2,
  noProgressBlockAfter: 5,
  idempotentTools: IDEMPOTENT_TOOL_NAMES,
  mutatingTools: MUTATING_TOOL_NAMES,
}

export type GuardrailAction = "allow" | "warn" | "block" | "halt"

export interface ToolCallSignature {
  toolName: string
  argsHash: string
}

export interface ToolGuardrailDecision {
  action: GuardrailAction
  code: string
  message: string
  toolName: string
  count: number
  signature: ToolCallSignature | null
  allowsExecution: boolean
  shouldHalt: boolean
  isWarn: boolean
}

const ALLOW: ToolGuardrailDecision = {
  action: "allow",
  code: "allow",
  message: "",
  toolName: "",
  count: 0,
  signature: null,
  allowsExecution: true,
  shouldHalt: false,
  isWarn: false,
}

function makeDecision(
  action: GuardrailAction,
  code: string,
  message: string,
  toolName: string,
  count: number,
  signature: ToolCallSignature,
): ToolGuardrailDecision {
  return {
    action,
    code,
    message,
    toolName,
    count,
    signature,
    allowsExecution: action === "allow" || action === "warn",
    shouldHalt: action === "block" || action === "halt",
    isWarn: action === "warn",
  }
}

export function canonicalToolArgs(args: Record<string, unknown> | null | undefined): string {
  if (!args || typeof args !== "object") return "{}"
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(args).sort()) sorted[k] = args[k]
  return JSON.stringify(sorted, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
}

function sha256Hex(input: string): string {
  // Bun ships a fast crypto module. Use Bun.hash + hex for 64-bit collision resistance
  // (the controller is not security-critical — it's a loop detector — so 64 bits is fine).
  return Bun.hash(input).toString(16).padStart(16, "0")
}

export function signatureFor(
  toolName: string,
  args: Record<string, unknown> | null | undefined,
): ToolCallSignature {
  return { toolName, argsHash: sha256Hex(canonicalToolArgs(args)) }
}

function resultHash(result: unknown): string {
  const text = typeof result === "string" ? result : safeStringify(result)
  return sha256Hex(text)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  } catch {
    return String(value)
  }
}

// Classify a tool result as failed. Mirrors Yomi's existing
// `toolFailed` / `actFailed` heuristics so the guardrail never disagrees
// with the pipeline's user-visible failure handling.
export function classifyToolFailure(toolName: string, result: unknown): boolean {
  if (result === undefined) return false
  if (typeof result === "string") {
    if (result.startsWith("Error")) return true
    if (result.includes("[DENIED:")) return true
    return false
  }
  if (typeof result !== "object" || result === null) return false
  const r = result as Record<string, unknown>
  if ("error" in r) return true
  if ("ok" in r && r.ok === false) return true
  // bash / terminal-style: { exit_code, ... } where exit_code !== 0
  if (toolName === "bash" && "exit_code" in r) {
    const ec = r.exit_code
    if (typeof ec === "number" && ec !== 0) return true
  }
  return false
}

function toolFailureRecoveryHint(toolName: string, count: number): string {
  const common =
    `${toolName} has failed ${count} times this turn. This looks like a loop. ` +
    "Do not switch to text-only replies; keep using tools, but diagnose before retrying. " +
    "First inspect the latest error/output and verify your assumptions. "
  if (toolName === "bash") {
    return (
      common +
      "For bash failures, run a small diagnostic such as `pwd && ls -la` " +
      "in the same tool, then try an absolute path, a simpler command, a different " +
      "working directory, or a different tool such as read_file/write_file."
    )
  }
  return (
    common +
    "Try different arguments, a narrower query/path, an absolute path when relevant, " +
    "or a different tool that can make progress. If the blocker is external, report " +
    "the blocker after one diagnostic attempt instead of repeating the same failing path."
  )
}

export class ToolCallGuardrailController {
  private readonly config: ToolCallGuardrailConfig
  private exactFailureCounts = new Map<string, number>()
  private sameToolFailureCounts = new Map<string, number>()
  private noProgress = new Map<string, { resultHash: string; repeatCount: number }>()
  private _haltDecision: ToolGuardrailDecision | null = null

  constructor(config: Partial<ToolCallGuardrailConfig> = {}) {
    this.config = { ...DEFAULT_GUARDRAIL_CONFIG, ...config }
  }

  resetForTurn(): void {
    this.exactFailureCounts = new Map()
    this.sameToolFailureCounts = new Map()
    this.noProgress = new Map()
    this._haltDecision = null
  }

  get haltDecision(): ToolGuardrailDecision | null {
    return this._haltDecision
  }

  beforeCall(
    toolName: string,
    args: Record<string, unknown> | null | undefined,
  ): ToolGuardrailDecision {
    const sig = signatureFor(toolName, args)
    if (!this.config.hardStopEnabled) {
      return { ...ALLOW, toolName, signature: sig }
    }

    const exactCount = this.exactFailureCounts.get(sig.argsHash) ?? 0
    if (exactCount >= this.config.exactFailureBlockAfter) {
      const decision = makeDecision(
        "block",
        "repeated_exact_failure_block",
        `Blocked ${toolName}: the same tool call failed ${exactCount} ` +
          "times with identical arguments. Stop retrying it unchanged; " +
          "change strategy or explain the blocker.",
        toolName,
        exactCount,
        sig,
      )
      this._haltDecision = decision
      return decision
    }

    if (this.isIdempotent(toolName)) {
      const record = this.noProgress.get(sig.argsHash)
      if (record && record.repeatCount >= this.config.noProgressBlockAfter) {
        const decision = makeDecision(
          "block",
          "idempotent_no_progress_block",
          `Blocked ${toolName}: this read-only call returned the same ` +
            `result ${record.repeatCount} times. Stop repeating it unchanged; ` +
            "use the result already provided or try a different query.",
          toolName,
          record.repeatCount,
          sig,
        )
        this._haltDecision = decision
        return decision
      }
    }

    return { ...ALLOW, toolName, signature: sig }
  }

  afterCall(
    toolName: string,
    args: Record<string, unknown> | null | undefined,
    result: unknown,
    failedOverride?: boolean,
  ): ToolGuardrailDecision {
    const sig = signatureFor(toolName, args)
    const failed = failedOverride ?? classifyToolFailure(toolName, result)

    if (failed) {
      const exactCount = (this.exactFailureCounts.get(sig.argsHash) ?? 0) + 1
      this.exactFailureCounts.set(sig.argsHash, exactCount)
      this.noProgress.delete(sig.argsHash)

      const sameCount = (this.sameToolFailureCounts.get(toolName) ?? 0) + 1
      this.sameToolFailureCounts.set(toolName, sameCount)

      if (this.config.hardStopEnabled && sameCount >= this.config.sameToolFailureHaltAfter) {
        const decision = makeDecision(
          "halt",
          "same_tool_failure_halt",
          `Stopped ${toolName}: it failed ${sameCount} times this turn. ` +
            "Stop retrying the same failing tool path and choose a different approach.",
          toolName,
          sameCount,
          sig,
        )
        this._haltDecision = decision
        return decision
      }

      if (this.config.warningsEnabled && exactCount >= this.config.exactFailureWarnAfter) {
        return makeDecision(
          "warn",
          "repeated_exact_failure_warning",
          `${toolName} has failed ${exactCount} times with identical arguments. ` +
            "This looks like a loop; inspect the error and change strategy " +
            "instead of retrying it unchanged.",
          toolName,
          exactCount,
          sig,
        )
      }

      if (this.config.warningsEnabled && sameCount >= this.config.sameToolFailureWarnAfter) {
        return makeDecision(
          "warn",
          "same_tool_failure_warning",
          toolFailureRecoveryHint(toolName, sameCount),
          toolName,
          sameCount,
          sig,
        )
      }

      return { ...ALLOW, toolName, count: exactCount, signature: sig }
    }

    // Success path — clear failure counters, track idempotent no-progress.
    this.exactFailureCounts.delete(sig.argsHash)
    this.sameToolFailureCounts.delete(toolName)

    if (!this.isIdempotent(toolName)) {
      this.noProgress.delete(sig.argsHash)
      return { ...ALLOW, toolName, signature: sig }
    }

    const hash = resultHash(result)
    const previous = this.noProgress.get(sig.argsHash)
    const repeatCount = previous && previous.resultHash === hash ? previous.repeatCount + 1 : 1
    this.noProgress.set(sig.argsHash, { resultHash: hash, repeatCount })

    if (this.config.warningsEnabled && repeatCount >= this.config.noProgressWarnAfter) {
      return makeDecision(
        "warn",
        "idempotent_no_progress_warning",
        `${toolName} returned the same result ${repeatCount} times. ` +
          "Use the result already provided or change the query instead of " +
          "repeating it unchanged.",
        toolName,
        repeatCount,
        sig,
      )
    }

    return { ...ALLOW, toolName, count: repeatCount, signature: sig }
  }

  private isIdempotent(toolName: string): boolean {
    if (this.config.mutatingTools.has(toolName)) return false
    return this.config.idempotentTools.has(toolName)
  }
}

export function syntheticBlockedResult(decision: ToolGuardrailDecision): string {
  return safeStringify({ error: decision.message, guardrail: decisionToMetadata(decision) })
}

export function appendGuidance(result: unknown, decision: ToolGuardrailDecision): unknown {
  if (decision.action !== "warn" && decision.action !== "halt") return result
  if (!decision.message) return result
  const label = decision.action === "halt" ? "Tool loop hard stop" : "Tool loop warning"
  const suffix = `\n\n[${label}: ${decision.code}; count=${decision.count}; ${decision.message}]`
  if (typeof result === "string") return result + suffix
  return safeStringify(result) + suffix
}

export function decisionToMetadata(d: ToolGuardrailDecision): Record<string, unknown> {
  return {
    action: d.action,
    code: d.code,
    message: d.message,
    toolName: d.toolName,
    count: d.count,
    signature: d.signature
      ? { toolName: d.signature.toolName, argsHash: d.signature.argsHash }
      : null,
  }
}
