import { describe, expect, it, mock } from "bun:test"

let prefs: Record<string, unknown> = {}
let consents: { purpose: string; status: string }[] = []

mock.module("./preferences.js", () => ({
  getPrivacyPreferences: async () => prefs,
}))

let recordedGrants: { purposes: string[]; status: string; source: unknown }[] = []

mock.module("./consent.js", () => ({
  getConsentSnapshot: async () => consents,
  recordConsentDecision: async (input: {
    purposes: string[]
    status: string
    context: { metadata?: { source?: unknown } }
  }) => {
    recordedGrants.push({
      purposes: input.purposes,
      status: input.status,
      source: input.context.metadata?.source,
    })
    return []
  },
}))

const { checkConsent, grantConsentIfUndecided } = await import("./checks.js")

describe("checkConsent decided semantics", () => {
  it("undecided when no consent row exists", async () => {
    prefs = { conversationHistoryEnabled: false }
    consents = []
    const res = await checkConsent("u1", "conversation_history")
    expect(res.allowed).toBe(false)
    expect(res.decided).toBe(false)
  })

  it("decided when consent was explicitly revoked", async () => {
    prefs = { conversationHistoryEnabled: false }
    consents = [{ purpose: "conversation_history", status: "revoked" }]
    const res = await checkConsent("u1", "conversation_history")
    expect(res.allowed).toBe(false)
    expect(res.decided).toBe(true)
  })

  it("decided even when preference off but consent granted", async () => {
    prefs = { telegramProcessingEnabled: false }
    consents = [{ purpose: "telegram_processing", status: "granted" }]
    const res = await checkConsent("u1", "telegram_processing")
    expect(res.allowed).toBe(false)
    expect(res.decided).toBe(true)
  })

  it("allowed when preference on and consent granted", async () => {
    prefs = { conversationHistoryEnabled: true }
    consents = [{ purpose: "conversation_history", status: "granted" }]
    const res = await checkConsent("u1", "conversation_history")
    expect(res.allowed).toBe(true)
    expect(res.decided).toBe(true)
  })
})

describe("grantConsentIfUndecided", () => {
  it("grants only purposes with no prior decision", async () => {
    prefs = {}
    consents = [{ purpose: "memory", status: "granted" }]
    recordedGrants = []
    await grantConsentIfUndecided("u1", ["memory", "connector_data"], "connector_oauth")
    expect(recordedGrants).toHaveLength(1)
    expect(recordedGrants[0]?.purposes).toEqual(["connector_data"])
    expect(recordedGrants[0]?.status).toBe("granted")
    expect(recordedGrants[0]?.source).toBe("connector_oauth")
  })

  it("never overrides an explicit revocation", async () => {
    prefs = {}
    consents = [{ purpose: "connector_data", status: "revoked" }]
    recordedGrants = []
    await grantConsentIfUndecided("u1", ["connector_data"], "connector_oauth")
    expect(recordedGrants).toHaveLength(0)
  })

  it("does nothing when every purpose is already decided", async () => {
    prefs = {}
    consents = [{ purpose: "connector_data", status: "granted" }]
    recordedGrants = []
    await grantConsentIfUndecided("u1", ["connector_data"], "connector_api_key")
    expect(recordedGrants).toHaveLength(0)
  })
})
