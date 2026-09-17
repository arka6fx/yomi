import { beforeEach, describe, expect, it, mock } from "bun:test"

// Every select the module makes is decorated with `.limit()` (preferences) or
// `.orderBy()` (consent history), so the stub exposes both and counts calls —
// the whole point of the cache is how many reads reach the database per turn.
let selectCount = 0
let activeRows: unknown[] = []
let failNextSelect = false

function selectResult(): Promise<unknown[]> {
  selectCount++
  if (failNextSelect) {
    failNextSelect = false
    return Promise.reject(new Error("db down"))
  }
  return Promise.resolve(activeRows)
}

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectResult(),
          orderBy: () => selectResult(),
        }),
      }),
    }),
  },
  privacyPreferences: {},
  privacyConsents: {},
}))

mock.module("../../auth-schema.js", () => ({ user: {} }))

const { getPrivacyPreferences, invalidatePrivacyReadCache } = await import("./preferences.js")
const { getConsentSnapshot } = await import("./consent.js")

function prefRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u",
    conversationHistoryEnabled: true,
    memoryEnabled: true,
    cloudMemoryEnabled: true,
    connectorsEnabled: true,
    analyticsEnabled: true,
    voiceProcessingEnabled: true,
    aiImprovementEnabled: true,
    telegramProcessingEnabled: true,
    retentionOverrides: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

const consentRow = {
  id: "c1",
  purpose: "conversation_history",
  status: "granted",
  consentVersion: "v1",
  privacyPolicyVersion: "v1",
  termsVersion: "v1",
  appVersion: null,
  createdAt: new Date(),
}

beforeEach(() => {
  selectCount = 0
  activeRows = [prefRow()]
  failNextSelect = false
})

describe("privacy read cache", () => {
  it("answers repeated preference reads from a single query", async () => {
    await getPrivacyPreferences("cache-hit-user")
    await getPrivacyPreferences("cache-hit-user")
    expect(selectCount).toBe(1)
  })

  it("keeps separate entries per user", async () => {
    await getPrivacyPreferences("multi-a")
    await getPrivacyPreferences("multi-b")
    await getPrivacyPreferences("multi-a")
    expect(selectCount).toBe(2)
  })

  it("re-reads after an explicit invalidation", async () => {
    await getPrivacyPreferences("invalidated-user")
    invalidatePrivacyReadCache("invalidated-user")
    await getPrivacyPreferences("invalidated-user")
    expect(selectCount).toBe(2)
  })

  it("does not cache a failed read", async () => {
    failNextSelect = true
    await expect(getPrivacyPreferences("flaky-user")).rejects.toThrow("db down")
    await getPrivacyPreferences("flaky-user")
    expect(selectCount).toBe(2)
  })

  it("dedupes the consent snapshot lookup", async () => {
    activeRows = [consentRow]
    const first = await getConsentSnapshot("consent-user")
    const second = await getConsentSnapshot("consent-user")
    expect(selectCount).toBe(1)
    expect(second).toEqual(first)
  })
})
