import { describe, expect, it, mock } from "bun:test"

let prefs: Record<string, unknown> = {}
let consents: { purpose: string; status: string }[] = []

mock.module("./preferences.js", () => ({
  getPrivacyPreferences: async () => prefs,
}))

mock.module("./consent.js", () => ({
  getConsentSnapshot: async () => consents,
}))

const { checkConsent } = await import("./checks.js")

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
