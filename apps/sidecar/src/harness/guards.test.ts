import { describe, expect, it } from "bun:test"
import { LoopGuards } from "./guards.js"

describe("LoopGuards", () => {
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
