import { describe, it, expect } from "bun:test"
import { gateWrite, type ConnectorContext } from "./connector-def.js"

function baseCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    userId: "u1",
    getAccessToken: async () => "token",
    ...overrides,
  }
}

const meta = {
  connector: "gmail",
  action: "send_email",
  risk: "send" as const,
  title: "Send email",
  preview: "To: x@y.z",
}

describe("gateWrite capability enforcement", () => {
  it("runs directly with no createPendingAction and no capabilities (unchanged behavior)", async () => {
    let ran = false
    const result = await gateWrite(baseCtx(), meta, { to: "x" }, async () => {
      ran = true
      return "sent"
    })
    expect(ran).toBe(true)
    expect(result).toBe("sent")
  })

  it("queues a pending action when a capability grants connector:execute", async () => {
    let queued = false
    let ran = false
    const ctx = baseCtx({
      capabilities: ["connector:execute"],
      createPendingAction: async () => {
        queued = true
        return { id: "p1", status: "pending", message: "queued" }
      },
    })
    const result = await gateWrite(ctx, meta, {}, async () => {
      ran = true
      return "sent"
    })
    expect(queued).toBe(true)
    expect(ran).toBe(false)
    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("denies without running or queuing when connector:execute is missing", async () => {
    let queued = false
    let ran = false
    const ctx = baseCtx({
      capabilities: ["connector:read"],
      createPendingAction: async () => {
        queued = true
        return { id: "p1", status: "pending", message: "queued" }
      },
    })
    const result = await gateWrite(ctx, meta, {}, async () => {
      ran = true
      return "sent"
    })
    expect(queued).toBe(false)
    expect(ran).toBe(false)
    expect(result).toMatchObject({ status: "denied" })
    expect((result as { message: string }).message).toContain("connector:execute")
  })

  it("runs directly when a capability grants execute but no createPendingAction (replay path)", async () => {
    let ran = false
    const ctx = baseCtx({ capabilities: ["connector:*"] })
    const result = await gateWrite(ctx, meta, {}, async () => {
      ran = true
      return "sent"
    })
    expect(ran).toBe(true)
    expect(result).toBe("sent")
  })
})
