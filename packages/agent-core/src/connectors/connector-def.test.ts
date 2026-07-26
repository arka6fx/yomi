import { describe, it, expect } from "bun:test"
import { connectorError, gateWrite, type ConnectorContext } from "./connector-def.js"

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

describe("connectorError", () => {
  it("adds a messaging-window hint for Instagram's 24h DM policy", () => {
    const err = new Error(
      'Failed to send message (status 403). Response: {"error":{"message":"This message is sent outside of allowed window.","type":"IGApiException","code":10,"error_subcode":2534022}}',
    )
    const result = connectorError(err)
    expect(result.hint).toContain("24 hours")
    expect(result.hint).toContain("Instagram")
  })

  it("adds a messaging-window hint for WhatsApp's 24h re-engagement policy", () => {
    const err = new Error(
      'Failed to send message (status 403). Response: {"error":{"message":"Re-engagement message","type":"OAuthException","code":131047}}',
    )
    const result = connectorError(err)
    expect(result.hint).toContain("template")
    expect(result.hint).toContain("WhatsApp")
  })

  it("falls back to a reconnect hint for an unrelated 403", () => {
    const err = new Error("Composio execute SLACK_SEND_MESSAGE → status 403: forbidden")
    const result = connectorError(err)
    expect(result.hint).toContain("reconnect")
  })

  it("does not call a Facebook Messenger messaging-window error 'Instagram' — same Meta policy, different app", () => {
    // Facebook Messenger's Send API enforces the identical 24h messaging-window
    // policy as Instagram, but with Facebook's own error shape (OAuthException,
    // a different error_subcode) — not IGApiException, not subcode 2534022.
    // The old isInstagramWindow check matched on the generic phrase alone, so a
    // Facebook error got a hint that confusingly said "Instagram".
    const err = new Error(
      'Failed to send message (status 403). Response: {"error":{"message":"This message is sent outside of allowed window.","type":"OAuthException","code":10,"error_subcode":2018278}}',
    )
    const result = connectorError(err)
    expect(result.hint).toContain("24 hours")
    expect(result.hint).not.toContain("Instagram")
  })

  it("still calls a real Instagram messaging-window error 'Instagram'", () => {
    const err = new Error(
      'Failed to send message (status 403). Response: {"error":{"message":"This message is sent outside of allowed window.","type":"IGApiException","code":10,"error_subcode":2534022}}',
    )
    const result = connectorError(err)
    expect(result.hint).toContain("Instagram")
  })

  it("adds a reconnect hint for Google's UNAUTHENTICATED shape, not just the literal words 'unauthorized'/'forbidden'", () => {
    // Real response, reproduced live via Composio against the Photos Library API:
    // a 200-but-successful:false call whose error string is Google's own nested
    // JSON. It says "UNAUTHENTICATED" and "invalid authentication credentials" —
    // never the word "unauthorized" our regex was matching on — so it fell
    // through with no reconnect hint and the model was left to guess "not
    // connected" from an opaque JSON blob.
    const err = new Error(
      'Composio execute GOOGLEPHOTOS_LIST_ALBUMS → status 200: {\n  "error": {\n    "code": 401,\n    "message": "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.",\n    "status": "UNAUTHENTICATED"\n  }\n}\n',
    )
    const result = connectorError(err)
    expect(result.hint).toContain("reconnect")
  })
})
