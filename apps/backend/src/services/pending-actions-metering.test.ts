import { beforeEach, describe, expect, it, mock } from "bun:test"

// Verifies replay-time Composio metering: an approved write executed via
// approvePendingAction charges exactly one composio_tool call — and ONLY for
// Composio-backed connectors (native replays must not be Composio-metered).

let connectorKind: "composio" | "oauth2" = "composio"
const charges: Array<Record<string, unknown>> = []
const telemetry: Array<Record<string, unknown>> = []
let userExists = true

mock.module("@yomi/db", () => ({ db: {}, pendingActions: {} }))
mock.module("../connectors/defs/index.js", () => ({}))
mock.module("../connectors/registry.js", () => ({
  getConnectorDef: (id: string) =>
    id === "unknown" ? undefined : { auth: { kind: connectorKind } },
}))
mock.module("./metering.js", () => ({
  loadMeteringUser: async () => (userExists ? { id: "user_1", plan: "pro" } : null),
  chargeUsage: async (input: Record<string, unknown>) => {
    charges.push(input)
    return { ok: true, creditsCharged: 1, usageEventId: "evt_replay" }
  },
}))
mock.module("./ai-telemetry.js", () => ({
  recordAiUsage: async (input: Record<string, unknown>) => {
    telemetry.push(input)
  },
}))

const { meterComposioReplay } = await import("./pending-actions.js")

beforeEach(() => {
  charges.length = 0
  telemetry.length = 0
  connectorKind = "composio"
  userExists = true
})

describe("meterComposioReplay", () => {
  it("charges one composio_tool call for an approved Composio write", async () => {
    await meterComposioReplay("linear", "user_1", "LINEAR_CREATE_LINEAR_ISSUE")
    expect(charges).toHaveLength(1)
    expect(charges[0]).toMatchObject({
      kind: "composio_tool",
      units: 1,
      metadata: { replay: true, action: "LINEAR_CREATE_LINEAR_ISSUE" },
    })
    expect(telemetry[0]).toMatchObject({ provider: "composio", toolCalls: 1, creditsCharged: 1 })
    expect(telemetry[0]!["totalApiCostMicros"]).toBeGreaterThan(0)
  })

  it("does NOT charge for a native (non-composio) connector replay", async () => {
    connectorKind = "oauth2"
    await meterComposioReplay("linear", "user_1", "linear-createIssue")
    expect(charges).toHaveLength(0)
    expect(telemetry).toHaveLength(0)
  })

  it("skips silently for an unknown connector", async () => {
    await meterComposioReplay("unknown", "user_1", "whatever")
    expect(charges).toHaveLength(0)
  })

  it("skips when the user can't be loaded", async () => {
    userExists = false
    await meterComposioReplay("linear", "user_1", "LINEAR_CREATE_LINEAR_ISSUE")
    expect(charges).toHaveLength(0)
  })
})
