import { afterEach, describe, expect, it } from "bun:test"
import type { SseEvent, UiaAction } from "@yomi/shared"
import {
  emitActResult,
  requestConfirmation,
  resolveConfirmation,
  setActEmitter,
} from "./act-bus.js"

const action: UiaAction = { kind: "invoke", ref: "w1e1" }

describe("act-bus", () => {
  afterEach(() => {
    setActEmitter(null)
    delete process.env.YOMI_ACT_AUTOCONFIRM
  })

  it("emits act_proposed and resolves when the desktop approves", async () => {
    const events: SseEvent[] = []
    setActEmitter((e) => events.push(e))

    const decision = requestConfirmation(action, "Delete", "destructive")
    const proposed = events.find((e) => e.type === "act_proposed")
    expect(proposed).toBeDefined()
    const id = proposed!.type === "act_proposed" ? proposed!.id : ""
    expect(id).toBeTruthy()

    expect(resolveConfirmation(id, true)).toBe(true)
    expect(await decision).toBe(true)
  })

  it("resolves false when the desktop rejects", async () => {
    const events: SseEvent[] = []
    setActEmitter((e) => events.push(e))
    const decision = requestConfirmation(action, "Send", "destructive")
    const id = (events[0] as Extract<SseEvent, { type: "act_proposed" }>).id
    resolveConfirmation(id, false)
    expect(await decision).toBe(false)
  })

  it("falls back to the safety confirmer when no stream is attached", async () => {
    process.env.YOMI_ACT_AUTOCONFIRM = "true"
    expect(await requestConfirmation(action, "Delete", "destructive")).toBe(true)
  })

  it("denies pending confirmations when the stream detaches", async () => {
    setActEmitter((e) => void e)
    const decision = requestConfirmation(action, "Delete", "destructive")
    setActEmitter(null) // stream ended mid-confirmation
    expect(await decision).toBe(false)
  })

  it("ignores unknown confirmation ids", () => {
    expect(resolveConfirmation("nope", true)).toBe(false)
  })

  it("emitActResult is a no-op without an emitter", () => {
    expect(() => emitActResult(true, "x")).not.toThrow()
  })
})
