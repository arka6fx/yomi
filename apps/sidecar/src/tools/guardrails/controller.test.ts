import { describe, expect, it } from "bun:test"
import {
  DEFAULT_GUARDRAIL_CONFIG,
  ToolCallGuardrailController,
  appendGuidance,
  canonicalToolArgs,
  classifyToolFailure,
  decisionToMetadata,
  signatureFor,
  syntheticBlockedResult,
  type ToolGuardrailDecision,
} from "./controller.js"

const hardStop = { ...DEFAULT_GUARDRAIL_CONFIG, hardStopEnabled: true }

describe("canonicalToolArgs", () => {
  it("sorts keys deterministically", () => {
    expect(canonicalToolArgs({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })
  it("handles null and undefined as empty", () => {
    expect(canonicalToolArgs(null)).toBe("{}")
    expect(canonicalToolArgs(undefined)).toBe("{}")
  })
  it("serializes bigints safely", () => {
    expect(canonicalToolArgs({ n: 1n as unknown as number })).toContain('"n":"1"')
  })
})

describe("signatureFor", () => {
  it("returns a stable hash for equivalent args regardless of key order", () => {
    const s1 = signatureFor("read_file", { path: "x", encoding: "utf-8" })
    const s2 = signatureFor("read_file", { encoding: "utf-8", path: "x" })
    expect(s1.argsHash).toBe(s2.argsHash)
  })
  it("differs when args differ", () => {
    expect(signatureFor("read_file", { path: "x" }).argsHash).not.toBe(
      signatureFor("read_file", { path: "y" }).argsHash,
    )
  })
})

describe("classifyToolFailure", () => {
  it("flags strings starting with Error", () => {
    expect(classifyToolFailure("read_file", "Error: not found")).toBe(true)
  })
  it("flags [DENIED: marker from applyHooks", () => {
    expect(classifyToolFailure("bash", "[DENIED: command matches denylist]")).toBe(true)
  })
  it("flags object results with error property", () => {
    expect(classifyToolFailure("read_file", { error: "not found" })).toBe(true)
  })
  it("flags object results with ok: false", () => {
    expect(classifyToolFailure("write_file", { ok: false })).toBe(true)
  })
  it("flags bash results with non-zero exit_code", () => {
    expect(classifyToolFailure("bash", { exit_code: 2, stderr: "boom" })).toBe(true)
  })
  it("does not flag a successful bash result", () => {
    expect(classifyToolFailure("bash", { exit_code: 0, stdout: "ok" })).toBe(false)
  })
  it("returns false for benign strings", () => {
    expect(classifyToolFailure("read_file", "hello world")).toBe(false)
  })
})

describe("ToolCallGuardrailController — warnings (default config)", () => {
  it("warns on the 2nd exact failure with identical args", () => {
    const c = new ToolCallGuardrailController()
    c.afterCall("read_file", { path: "x" }, { error: "missing" })
    const d = c.afterCall("read_file", { path: "x" }, { error: "missing" })
    expect(d.action).toBe("warn")
    expect(d.code).toBe("repeated_exact_failure_warning")
    expect(d.count).toBe(2)
  })

  it("warns on the 3rd same-tool failure with different args", () => {
    const c = new ToolCallGuardrailController()
    c.afterCall("bash", { command: "ls /a" }, { exit_code: 2 })
    c.afterCall("bash", { command: "ls /b" }, { exit_code: 2 })
    const d = c.afterCall("bash", { command: "ls /c" }, { exit_code: 2 })
    expect(d.action).toBe("warn")
    expect(d.code).toBe("same_tool_failure_warning")
  })

  it("warns on idempotent no-progress when result repeats", () => {
    const c = new ToolCallGuardrailController()
    c.afterCall("list_files", { dir: "memory" }, [{ name: "a.md" }])
    const d = c.afterCall("list_files", { dir: "memory" }, [{ name: "a.md" }])
    expect(d.action).toBe("warn")
    expect(d.code).toBe("idempotent_no_progress_warning")
  })

  it("does not warn on no-progress for mutating tools", () => {
    const c = new ToolCallGuardrailController()
    c.afterCall("write_file", { path: "x" }, { ok: true })
    const d = c.afterCall("write_file", { path: "x" }, { ok: true })
    expect(d.action).toBe("allow")
  })

  it("a success resets the per-signature failure counter", () => {
    const c = new ToolCallGuardrailController()
    c.afterCall("read_file", { path: "x" }, { error: "missing" })
    c.afterCall("read_file", { path: "x" }, "ok content")
    const d = c.afterCall("read_file", { path: "x" }, { error: "missing" })
    expect(d.action).toBe("allow")
  })
})

describe("ToolCallGuardrailController — hard stop (block/halt)", () => {
  it("blocks an idempotent call that has returned the same result >= noProgressBlockAfter", () => {
    const c = new ToolCallGuardrailController(hardStop)
    const sig = { dir: "memory" }
    for (let i = 0; i < DEFAULT_GUARDRAIL_CONFIG.noProgressBlockAfter; i++) {
      c.afterCall("list_files", sig, [{ name: "a.md" }])
    }
    const d = c.beforeCall("list_files", sig)
    expect(d.action).toBe("block")
    expect(d.code).toBe("idempotent_no_progress_block")
  })

  it("halts on same-tool failure count reaching the halt threshold", () => {
    const c = new ToolCallGuardrailController(hardStop)
    let lastDecision: ToolGuardrailDecision = c.afterCall(
      "bash",
      { command: "warmup" },
      { exit_code: 0 },
    )
    for (let i = 0; i < DEFAULT_GUARDRAIL_CONFIG.sameToolFailureHaltAfter; i++) {
      lastDecision = c.afterCall("bash", { command: `cmd ${i}` }, { exit_code: 1 })
    }
    expect(lastDecision.action).toBe("halt")
    expect(lastDecision.code).toBe("same_tool_failure_halt")
    expect(c.haltDecision).not.toBeNull()
  })

  it("blocks a previously-failed exact call when the threshold is reached", () => {
    const c = new ToolCallGuardrailController(hardStop)
    const sig = { path: "missing.md" }
    for (let i = 0; i < DEFAULT_GUARDRAIL_CONFIG.exactFailureBlockAfter; i++) {
      c.afterCall("read_file", sig, { error: "not found" })
    }
    const d = c.beforeCall("read_file", sig)
    expect(d.action).toBe("block")
    expect(d.code).toBe("repeated_exact_failure_block")
  })
})

describe("ToolCallGuardrailController — turn lifecycle", () => {
  it("resetForTurn clears all counters and the halt decision", () => {
    const c = new ToolCallGuardrailController(hardStop)
    for (let i = 0; i < DEFAULT_GUARDRAIL_CONFIG.sameToolFailureHaltAfter; i++) {
      c.afterCall("bash", { command: `c ${i}` }, { exit_code: 1 })
    }
    expect(c.haltDecision).not.toBeNull()
    c.resetForTurn()
    expect(c.haltDecision).toBeNull()
    // After reset, a single failure is just a normal observation.
    const d = c.afterCall("bash", { command: "fresh" }, { exit_code: 1 })
    expect(d.action).toBe("allow")
  })

  it("beforeCall returns allow when hardStopEnabled is false", () => {
    const c = new ToolCallGuardrailController() // hardStopEnabled: false (default)
    // Stuff the failure counter directly via repeated failures in soft mode.
    for (let i = 0; i < 20; i++) {
      c.afterCall("read_file", { path: "x" }, { error: "missing" })
    }
    const d = c.beforeCall("read_file", { path: "x" })
    expect(d.action).toBe("allow")
    expect(c.haltDecision).toBeNull()
  })
})

describe("syntheticBlockedResult / appendGuidance / decisionToMetadata", () => {
  it("builds a JSON string with the error and guardrail metadata", () => {
    const c = new ToolCallGuardrailController(hardStop)
    for (let i = 0; i < DEFAULT_GUARDRAIL_CONFIG.noProgressBlockAfter; i++) {
      c.afterCall("list_files", { dir: "memory" }, [{ name: "a.md" }])
    }
    const decision = c.beforeCall("list_files", { dir: "memory" })
    const json = syntheticBlockedResult(decision)
    const parsed = JSON.parse(json) as { error: string; guardrail: { code: string } }
    expect(parsed.error).toContain("Blocked list_files")
    expect(parsed.guardrail.code).toBe("idempotent_no_progress_block")
  })

  it("appends guidance to string results but passes through non-warn actions", () => {
    const decision = {
      action: "warn" as const,
      code: "x",
      message: "loop",
      toolName: "read_file",
      count: 3,
      signature: null,
      allowsExecution: true,
      shouldHalt: false,
      isWarn: true,
    }
    const out = appendGuidance("content", decision) as string
    expect(out).toContain("Tool loop warning")
    expect(appendGuidance("content", { ...decision, action: "allow" })).toBe("content")
  })

  it("decisionToMetadata exposes the public shape", () => {
    const d = {
      action: "warn" as const,
      code: "x",
      message: "m",
      toolName: "read_file",
      count: 1,
      signature: { toolName: "read_file", argsHash: "abc" },
      allowsExecution: true,
      shouldHalt: false,
      isWarn: true,
    }
    const meta = decisionToMetadata(d)
    expect(meta.code).toBe("x")
    expect((meta.signature as { argsHash: string }).argsHash).toBe("abc")
  })
})
