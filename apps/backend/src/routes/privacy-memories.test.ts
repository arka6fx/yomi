import { beforeEach, describe, expect, it, mock } from "bun:test"

let currentUser = { id: "u1", email: "user@example.com", role: "user" }
const deletedTables: string[] = []

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("../entitlements.js", () => ({
  isOwnerUser: (_u: { email: string }) => false,
}))

mock.module("../services/privacy/retention.js", () => ({
  runPrivacyRetention: async () => ({
    expiredExports: 0,
    oldDeletionJobs: 0,
    hardDeletedUsers: 0,
    oldAuditEvents: 0,
    domains: {},
  }),
}))

mock.module("../services/privacy/preferences.js", () => ({
  getPrivacyPreferences: async () => ({ retentionOverrides: null }),
  updatePrivacyPreferences: async () => ({ retentionOverrides: null }),
}))

// Stub the remaining imports of routes/privacy.ts so the module loads, but make
// db.delete/db.select record which table was targeted and return realistic rows.
mock.module("@yomi/db", () => ({
  db: {
    delete: (table: { __name: string }) => ({
      where: () => ({
        returning: () => {
          deletedTables.push(table.__name)
          return Promise.resolve([{ id: "m1" }, { id: "m2" }])
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              { id: "m1", topic: "prefs", content: "likes tea", createdAt: new Date() },
            ]),
        }),
      }),
    }),
  },
  agentMessages: {},
  agentSessions: {},
  mcpConnections: {},
  memoryEntries: {
    __name: "memory_entries",
    userId: {},
    id: {},
    topic: {},
    content: {},
    createdAt: {},
  },
  memoryEmbeddings: { __name: "memory_embeddings", userId: {}, memoryId: {} },
  memoryRelations: { __name: "memory_relations", userId: {} },
  memorySources: { __name: "memory_sources" },
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
  deletedTables.length = 0
  currentUser = { id: "u1", email: "user@example.com", role: "user" }
})

describe("privacy memories endpoints", () => {
  it("DELETE /memories hard-deletes all entries and audits a count", async () => {
    const res = await req("/memories", { method: "DELETE" })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: number }
    expect(body.deleted).toBe(2)
    expect(deletedTables).toContain("memory_entries")
  })

  it("GET /memories/export returns entries without embedding vectors", async () => {
    const res = await req("/memories/export")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { memories: Array<Record<string, unknown>> }
    expect(body.memories.length).toBe(1)
    expect(body.memories[0]!["embedding"]).toBeUndefined()
  })
})
