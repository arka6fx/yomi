import { describe, expect, it } from "bun:test"
import { actFailed } from "./system.js"

describe("actFailed (decides when a UIA action should re-snapshot + retry)", () => {
  it("treats an explicit ok:false from the action ladder as a failure", () => {
    expect(actFailed({ ok: false, error: "no activation method succeeded", tried: ["Invoke:Timeout"] })).toBe(true)
  })

  it("treats an error result as a failure", () => {
    expect(actFailed({ error: "element no longer available" })).toBe(true)
  })

  it("treats a successful action as success", () => {
    expect(actFailed({ ok: true, method: "Click", name: "Send" })).toBe(false)
  })

  it("ignores non-objects", () => {
    expect(actFailed(undefined)).toBe(false)
    expect(actFailed("done")).toBe(false)
  })
})
