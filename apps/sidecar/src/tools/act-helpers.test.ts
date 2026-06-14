import { describe, expect, it } from "bun:test"
import type { UiaElement } from "@yomi/shared"
import { actionabilityFailure, attemptAct, canUseVisualFallback, foregroundChanged } from "./act-helpers.js"

function el(over: Partial<UiaElement> = {}): UiaElement {
  return {
    ref: "w1e1",
    role: "Button",
    name: "Save",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    patterns: ["Invoke"],
    enabled: true,
    ...over,
  }
}

describe("actionabilityFailure", () => {
  it("fails fast for disabled elements", () => {
    expect(actionabilityFailure(el({ enabled: false }))).toEqual({
      ok: false,
      error: "element is disabled",
      code: "element_not_enabled",
    })
  })

  it("allows enabled elements to continue", () => {
    expect(actionabilityFailure(el({ enabled: true }))).toBeNull()
  })

  it("fails fast for elements without a usable rectangle", () => {
    expect(actionabilityFailure(el({ rect: { x: 0, y: 0, width: 0, height: 10 } }))).toMatchObject({
      ok: false,
      code: "no_bounding_rect",
    })
    expect(actionabilityFailure(el({ rect: { x: 0, y: 0, width: 10, height: 0 } }))).toMatchObject({
      ok: false,
      code: "no_bounding_rect",
    })
  })

  it("fails fast for offscreen elements without ScrollItem", () => {
    expect(actionabilityFailure(el({ offscreen: true, patterns: ["Invoke"] }))).toMatchObject({
      ok: false,
      code: "element_offscreen",
    })
  })

  it("allows offscreen elements with ScrollItem for best-effort scrollIntoView", () => {
    expect(actionabilityFailure(el({ offscreen: true, patterns: ["Invoke", "ScrollItem"] }))).toBeNull()
  })

  it("fails semantic actions that lack their required UIA pattern", () => {
    expect(actionabilityFailure(el({ patterns: ["Invoke"] }), "set_value")).toMatchObject({ code: "no_actionable_pattern" })
    expect(actionabilityFailure(el({ patterns: [] }), "toggle")).toMatchObject({ code: "no_actionable_pattern" })
    expect(actionabilityFailure(el({ patterns: ["Invoke"] }), "expand")).toMatchObject({ code: "no_actionable_pattern" })
    expect(actionabilityFailure(el({ patterns: ["Invoke"] }), "scroll")).toMatchObject({ code: "no_actionable_pattern" })
  })

  it("allows semantic actions with matching UIA patterns", () => {
    expect(actionabilityFailure(el({ patterns: ["Value"] }), "set_value")).toBeNull()
    expect(actionabilityFailure(el({ patterns: ["Toggle"] }), "toggle")).toBeNull()
    expect(actionabilityFailure(el({ patterns: ["ExpandCollapse"] }), "expand")).toBeNull()
    expect(actionabilityFailure(el({ patterns: ["Scroll"] }), "scroll")).toBeNull()
  })
})

describe("canUseVisualFallback", () => {
  it("allows visual fallback only after failed click-like UIA actions", () => {
    expect(canUseVisualFallback("invoke", { ok: false, error: "invoke failed" })).toBe(true)
    expect(canUseVisualFallback("right_click", { error: "right-click failed" })).toBe(true)
  })

  it("does not use visual fallback for successful or semantic actions", () => {
    expect(canUseVisualFallback("invoke", { ok: true })).toBe(false)
    expect(canUseVisualFallback("set_value", { ok: false, error: "set failed" })).toBe(false)
    expect(canUseVisualFallback("toggle", { ok: false, error: "toggle failed" })).toBe(false)
    expect(canUseVisualFallback("scroll", { ok: false, error: "scroll failed" })).toBe(false)
  })
})

describe("foregroundChanged", () => {
  it("detects focus moving away from the snapshotted window", () => {
    expect(foregroundChanged("Notepad", "Calculator")).toBe(true)
    expect(foregroundChanged("Notepad", "Notepad")).toBe(false)
    expect(foregroundChanged("", "Calculator")).toBe(false)
  })
})

describe("attemptAct telemetry", () => {
  it("does not add telemetry when no retry was needed", async () => {
    const result = await attemptAct("w1e1", async () => ({ ok: true }))

    expect(result).toEqual({ result: { ok: true }, retried: false })
  })
})
