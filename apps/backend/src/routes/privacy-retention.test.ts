import { beforeEach, describe, expect, it, mock } from "bun:test"

let currentUser = { id: "u1", email: "user@example.com", role: "user" }
let ownerEmails = ["owner@example.com"]
let retentionRunCount = 0
let storedOverrides: Record<string, unknown> | null = null

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("../entitlements.js", () => ({
  isOwnerUser: (u: { email: string }) => ownerEmails.includes(u.email),
}))

mock.module("../services/privacy/retention.js", () => ({
  runPrivacyRetention: async () => {
    retentionRunCount++
    return {
      expiredExports: 0,
      oldDeletionJobs: 0,
      hardDeletedUsers: 0,
      oldAuditEvents: 0,
      domains: {
        conversations: 0,
        rag_retrieval_logs: 0,
        usage_events: 0,
        pending_actions: 0,
        devices: 0,
        expired_codes: 0,
      },
    }
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
  retentionRunCount = 0
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

  it("PATCH /retention stores a valid tightening override", async () => {
    const res = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { conversations: 30 } }),
    })
    expect(res.status).toBe(200)
    expect(storedOverrides).toEqual({ conversations: 30 })
  })

  it("POST /admin/run-retention is owner-only", async () => {
    const denied = await req("/admin/run-retention", { method: "POST" })
    expect(denied.status).toBe(403)
    expect(retentionRunCount).toBe(0)
    currentUser = { id: "u2", email: "owner@example.com", role: "user" }
    const ok = await req("/admin/run-retention", { method: "POST" })
    expect(ok.status).toBe(200)
    expect(retentionRunCount).toBe(1)
  })
})
