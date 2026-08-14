import { beforeEach, describe, expect, it, mock } from "bun:test"

let currentUser = { id: "u1", email: "user@example.com", role: "user" }
let storedOverrides: Record<string, unknown> | null = null

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("../services/privacy/preferences.js", () => ({
  getPrivacyPreferences: async () => ({ retentionOverrides: storedOverrides }),
  updatePrivacyPreferences: async (_id: string, patch: Record<string, unknown>) => {
    storedOverrides = patch["retentionOverrides"] as Record<string, unknown> | null
    return { retentionOverrides: storedOverrides }
  },
}))

// Stub the remaining imports of routes/privacy.ts so the module loads.
mock.module("@yomi/db", () => ({
  db: {},
  agentMessages: {},
  agentSessions: {},
  mcpConnections: {},
  memoryEntries: {},
  memoryEmbeddings: {},
  memoryRelations: {},
  memorySources: {},
  platformConnections: {},
  privacyAuditEvents: {},
  ragChunks: {},
  ragSources: {},
  schedules: {},
  usageEvents: {},
}))
mock.module("../services/privacy/audit.js", () => ({
  clientIp: () => null,
  userAgent: () => null,
  listPrivacyActivity: async () => [],
  recordPrivacyAuditEvent: async () => {},
}))
mock.module("../services/privacy/consent.js", () => ({
  getConsentSnapshot: async () => [],
  listConsentHistory: async () => [],
  recordConsentDecision: async () => [],
}))
mock.module("../services/privacy/export.js", () => ({
  getExport: async () => null,
  listExports: async () => [],
  requestExport: async () => ({}),
}))
mock.module("../services/privacy/deletion.js", () => ({
  deleteMyData: async () => null,
  deleteAccount: async () => null,
  getDeletionJob: async () => null,
  listDeletionJobs: async () => [],
}))

const { privacyRouter } = await import("./privacy.js")

function req(path: string, init?: RequestInit) {
  return privacyRouter.request(path, init)
}

beforeEach(() => {
  storedOverrides = null
  currentUser = { id: "u1", email: "user@example.com", role: "user" }
})

describe("retention routes", () => {
  it("GET /retention returns defaults and overrides", async () => {
    const res = await req("/retention")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { defaults: Record<string, unknown> }
    expect(body.defaults["conversations"]).toBeDefined()
  })

  it("PATCH /retention rejects unknown domains and extended windows", async () => {
    const bad = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { nonsense: 10 } }),
    })
    expect(bad.status).toBe(400)
    const tooLong = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { conversations: 9999 } }),
    })
    expect(tooLong.status).toBe(400)
  })

  it("PATCH /retention rejects a missing overrides object", async () => {
    const res = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it("PATCH /retention rejects a non-overridable domain", async () => {
    const res = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { usage_events: 10 } }),
    })
    expect(res.status).toBe(400)
  })

  it("PATCH /retention rejects a value below the minimum of 1", async () => {
    const res = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { conversations: 0 } }),
    })
    expect(res.status).toBe(400)
  })

  it("PATCH /retention stores a valid tightening override", async () => {
    const res = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { conversations: 30 } }),
    })
    expect(res.status).toBe(200)
    expect(storedOverrides).toEqual({ conversations: 30 })
  })
})
