import { describe, expect, it } from "bun:test"
import { deterministicTaskId, withAutomationHeartbeat } from "./recovery.js"

describe("recovery utilities", () => {
  it("builds deterministic task ids", () => {
    const first = deterministicTaskId("uia/action", { kind: "invoke", ref: "w1e1" })
    const second = deterministicTaskId("uia/action", { kind: "invoke", ref: "w1e1" })
    const third = deterministicTaskId("uia/action", { kind: "invoke", ref: "w1e2" })

    expect(first).toBe(second)
    expect(first).not.toBe(third)
    expect(first.startsWith("uia-action-")).toBe(true)
  })

  it("allows long work that emits heartbeats", async () => {
    let beats = 0
    const result = await withAutomationHeartbeat(
      async (beat) => {
        beat()
        await Bun.sleep(20)
        beat()
        return "ok"
      },
      { idleTimeoutMs: 50, onHeartbeat: () => beats++ },
    )

    expect(result).toBe("ok")
    expect(beats).toBe(2)
  })

  it("fails work that goes idle", async () => {
    await expect(withAutomationHeartbeat(async () => {
      await Bun.sleep(80)
      return "late"
    }, { idleTimeoutMs: 20 })).rejects.toThrow("automation node idle timeout")
  })
})
