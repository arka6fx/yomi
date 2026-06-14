import { describe, expect, it } from "bun:test"
import { createUiaEventRecorder } from "./event-recorder.js"

describe("UiaEventRecorder", () => {
  it("serializes typed events in sequence", () => {
    const recorder = createUiaEventRecorder()
    recorder.record("focus", { hwnd: 123, window: "Calculator" })
    recorder.record("invoke", { ref: "w1e2", detail: { method: "Invoke" } })

    const events = recorder.snapshot()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ seq: 1, kind: "focus", hwnd: 123, window: "Calculator" })
    expect(events[1]).toMatchObject({ seq: 2, kind: "invoke", ref: "w1e2", detail: { method: "Invoke" } })
    expect(JSON.parse(recorder.serialize()).events).toHaveLength(2)
  })
})
