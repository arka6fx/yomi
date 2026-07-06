import { beforeEach, describe, expect, it, mock } from "bun:test"

const deleteCalls: Array<{ table: string }> = []

function fakeTable(name: string) {
  return {
    __name: name,
    createdAt: {},
    expiresAt: {},
    lastSeen: {},
    lastMessageAt: {},
    status: {},
    completedAt: {},
    deletedAt: {},
    used: {},
  }
}

mock.module("@yomi/db", () => ({
  db: {
    delete: (table: { __name: string }) => ({
      where: () => ({
        returning: () => {
          deleteCalls.push({ table: table.__name })
          return Promise.resolve([])
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  },
  privacyExports: fakeTable("privacy_exports"),
  privacyDeletionJobs: fakeTable("privacy_deletion_jobs"),
  privacyAuditEvents: fakeTable("privacy_audit_events"),
  agentMessages: fakeTable("agent_messages"),
  agentSessions: fakeTable("agent_sessions"),
  ragRetrievalLogs: fakeTable("rag_retrieval_logs"),
  usageEvents: fakeTable("usage_events"),
  pendingActions: fakeTable("pending_actions"),
  devices: fakeTable("devices"),
  linkingCodes: fakeTable("linking_codes"),
  telegramLinkTokens: fakeTable("telegram_link_tokens"),
  deviceCodes: fakeTable("device_codes"),
}))

mock.module("../../auth-schema.js", () => ({
  user: fakeTable("user"),
}))

const { runPrivacyRetention } = await import("./retention.js")

beforeEach(() => {
  deleteCalls.length = 0
})

describe("runPrivacyRetention domain sweeps", () => {
  it("sweeps every retention domain", async () => {
    const report = await runPrivacyRetention()
    const swept = deleteCalls.map((c) => c.table)
    for (const table of [
      "agent_messages",
      "rag_retrieval_logs",
      "usage_events",
      "pending_actions",
      "devices",
      "linking_codes",
      "telegram_link_tokens",
      "device_codes",
    ]) {
      expect(swept).toContain(table)
    }
    expect(report.domains["conversations"]).toBe(0)
    expect(report.domains["expired_codes"]).toBe(0)
  })
})
