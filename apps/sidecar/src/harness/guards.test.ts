import { beforeEach, describe, expect, it } from "bun:test"
import { LoopGuards } from "./guards.js"
import { toolGuardrail } from "./hooks.js"
import { DEFAULT_GUARDRAIL_CONFIG, ToolCallGuardrailController } from "../tools/guardrails/index.js"

describe("LoopGuards", () => {
  beforeEach(() => {
    toolGuardrail.resetForTurn()
  })

  it("breaks before allowing a third identical consecutive non-snapshot tool call", () => {
    const guards = new LoopGuards()

    expect(guards.onToolCall("press_key", { keys: "Tab" })).toEqual({ break: false })
    expect(guards.onToolCall("press_key", { keys: "Tab" })).toEqual({ break: false })
    expect(guards.onToolCall("press_key", { keys: "Tab" })).toEqual({
      break: true,
      reason: "duplicate: press_key called 3× with identical args",
    })
  })

  it("allows repeated get_ui_tree snapshots while UI state settles", () => {
    const guards = new LoopGuards()

    expect(guards.onToolCall("get_ui_tree", { maxNodes: 400 })).toEqual({ break: false })
    expect(guards.onToolCall("get_ui_tree", { maxNodes: 400 })).toEqual({ break: false })
    expect(guards.onToolCall("get_ui_tree", { maxNodes: 400 })).toEqual({ break: false })
    expect(guards.onToolCall("get_ui_tree", { maxNodes: 400 })).toEqual({ break: false })
  })

  it("does not count non-consecutive duplicate calls as a loop", () => {
    const guards = new LoopGuards()

    expect(guards.onToolCall("get_ui_tree", {})).toEqual({ break: false })
    expect(guards.onToolCall("press_key", { keys: "Tab" })).toEqual({ break: false })
    expect(guards.onToolCall("get_ui_tree", {})).toEqual({ break: false })
  })
})

describe("LoopGuards — guardrail halt integration", () => {
  it("breaks with a guardrail_halt reason when the controller trips", () => {
    // Drive a fresh hard-stop controller to its halt threshold, then point
    // LoopGuards at it via the optional constructor argument. This mirrors the
    // real call site: the module-level toolGuardrail singleton in production,
    // a per-test controller here.
    const controller = new ToolCallGuardrailController({ hardStopEnabled: true })
    for (let i = 0; i < DEFAULT_GUARDRAIL_CONFIG.sameToolFailureHaltAfter; i++) {
      controller.afterCall("bash", { command: `cmd ${i}` }, { exit_code: 1 })
    }
    expect(controller.haltDecision).not.toBeNull()

    const guards = new LoopGuards(controller)
    const result = guards.onStep()
    expect(result.break).toBe(true)
    if (result.break) {
      expect(result.reason).toMatch(/^guardrail_halt: same_tool_failure_halt — /)
    }
  })

  it("does not break when the controller has no halt decision", () => {
    const controller = new ToolCallGuardrailController({ hardStopEnabled: true })
    // Single failure: no halt yet.
    controller.afterCall("bash", { command: "x" }, { exit_code: 1 })
    expect(controller.haltDecision).toBeNull()

    const guards = new LoopGuards(controller)
    expect(guards.onStep()).toEqual({ break: false })
  })

  it("uses the module-level toolGuardrail when no controller is injected", () => {
    // The default constructor must read from the shared singleton. The module-level
    // toolGuardrail has hardStopEnabled: false, so its haltDecision stays null in
    // normal operation — verify the read doesn't throw and returns a clean
    // non-breaking step.
    const guards = new LoopGuards()
    expect(guards.onStep()).toEqual({ break: false })
  })
})
