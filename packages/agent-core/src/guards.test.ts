import { describe, expect, it } from "bun:test"
import { LoopGuards } from "./guards.js"

describe("LoopGuards duplicate-call guard", () => {
  it("breaks on the third identical consecutive tool call", () => {
    const guards = new LoopGuards()
    expect(guards.observe([{ toolName: "search", args: { q: "x" } }]).break).toBeNull()
    expect(guards.observe([{ toolName: "search", args: { q: "x" } }]).break).toBeNull()
    const third = guards.observe([{ toolName: "search", args: { q: "x" } }])
    expect(third.break).toBe("duplicate")
  })

  it("does not break on the same tool with different args", () => {
    const guards = new LoopGuards()
    expect(guards.observe([{ toolName: "search", args: { q: "a" } }]).break).toBeNull()
    expect(guards.observe([{ toolName: "search", args: { q: "b" } }]).break).toBeNull()
    expect(guards.observe([{ toolName: "search", args: { q: "c" } }]).break).toBeNull()
  })

  it("does not treat non-consecutive identical calls as a loop", () => {
    const guards = new LoopGuards()
    expect(guards.observe([{ toolName: "search", args: { q: "x" } }]).break).toBeNull()
    expect(guards.observe([{ toolName: "list", args: {} }]).break).toBeNull()
    expect(guards.observe([{ toolName: "search", args: { q: "x" } }]).break).toBeNull()
    expect(guards.observe([{ toolName: "list", args: {} }]).break).toBeNull()
  })
})

describe("LoopGuards stall guard", () => {
  it("breaks after two consecutive windows of only cheap tool calls", () => {
    const guards = new LoopGuards()
    let broke: string | undefined
    // 10 cheap steps (window 5 × 2 stalled windows) with varying args so the
    // duplicate guard never fires first.
    for (let i = 0; i < 10; i++) {
      const decision = guards.observe([{ toolName: "remember", args: { n: i } }])
      if (decision.break) broke = decision.break
    }
    expect(broke).toBe("stall")
  })

  it("does not stall when each window contains meaningful work", () => {
    const guards = new LoopGuards()
    for (let i = 0; i < 12; i++) {
      // Interleave a meaningful call every step so no window is empty.
      const decision = guards.observe([{ toolName: "search", args: { n: i } }])
      expect(decision.break).toBeNull()
    }
  })
})

describe("LoopGuards cheap-tool refund", () => {
  it("does not charge a step whose only tool calls are cheap", () => {
    const guards = new LoopGuards()
    expect(guards.observe([{ toolName: "remember", args: { n: 1 } }]).charged).toBe(false)
  })

  it("charges a step with at least one non-cheap tool call", () => {
    const guards = new LoopGuards()
    expect(guards.observe([{ toolName: "search", args: {} }]).charged).toBe(true)
  })

  it("charges a mixed step containing a non-cheap call", () => {
    const guards = new LoopGuards()
    const decision = guards.observe([
      { toolName: "remember", args: {} },
      { toolName: "search", args: {} },
    ])
    expect(decision.charged).toBe(true)
  })
})
