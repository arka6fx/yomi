import { beforeEach, describe, expect, it, mock } from "bun:test"

// Distinguishable identities for every table deletion.ts imports from "@yomi/db",
// so assertions can verify exactly which table object was passed to db.delete(...).
const mockTables = {
  agentMessages: { __name: "agentMessages" },
  agentSessions: { __name: "agentSessions" },
  linkingCodes: { __name: "linkingCodes" },
  mcpConnections: { __name: "mcpConnections" },
  memoryEmbeddings: { __name: "memoryEmbeddings" },
  memoryEntries: { __name: "memoryEntries" },
  memoryRelations: { __name: "memoryRelations" },
  pendingActions: { __name: "pendingActions" },
  platformConnections: { __name: "platformConnections" },
  privacyDeletionJobs: { __name: "privacyDeletionJobs" },
  ragChunks: { __name: "ragChunks" },
  ragDocuments: { __name: "ragDocuments" },
  ragEmbeddings: { __name: "ragEmbeddings" },
  ragRetrievalLogs: { __name: "ragRetrievalLogs" },
  ragSources: { __name: "ragSources" },
  schedules: { __name: "schedules" },
  usageEvents: { __name: "usageEvents" },
}

let deleteCalls: unknown[] = []

// select(...).from(...).where(...).orderBy(...).limit(...) chain that always
// resolves to an empty result set (no existing job, no linked google account,
// no dodo subscription) so every step in deletion.ts runs to completion.
function selectChain(rows: unknown[] = []) {
  const chain: {
    from: () => typeof chain
    where: () => typeof chain
    orderBy: () => typeof chain
    limit: () => typeof chain
    then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>
  } = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  }
  return chain
}

function insertChain(returningRows: unknown[]) {
  return { values: () => ({ returning: () => Promise.resolve(returningRows) }) }
}

function updateChain(returningRows: unknown[]) {
  const afterWhere = {
    returning: () => Promise.resolve(returningRows),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ rowCount: 0 }).then(resolve, reject),
  }
  return { set: () => ({ where: () => afterWhere }) }
}

const fakeDb = {
  select: () => selectChain([]),
  insert: () => insertChain([{ id: "job_1" }]),
  update: () => updateChain([{ id: "job_1", status: "completed" }]),
  delete: (table: unknown) => ({
    where: () => {
      deleteCalls.push(table)
      return {
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ rowCount: 0 }).then(resolve, reject),
      }
    },
  }),
}

mock.module("@yomi/db", () => ({ db: fakeDb, ...mockTables }))

mock.module("../token-encryption.js", () => ({
  decryptTokens: () => ({ accessToken: "tok", refreshToken: null, expiresAt: null }),
}))

mock.module("../../auth-schema.js", () => ({
  user: { __name: "authUser" },
  session: { __name: "authSession" },
}))

// deletion.ts only needs getDodoConfig; stub the whole billing route module so
// its unrelated Hono/Better-Auth import chain never loads under test.
mock.module("../../routes/billing.js", () => ({
  getDodoConfig: () => ({
    mode: "test",
    apiBase: "https://api.dodo.test",
    apiKey: null,
    webhookSecret: null,
    productIds: {},
  }),
}))

const { deleteMyData, deleteAccount } = await import("./deletion.js")

describe("Google Drive RAG sources deletion", () => {
  beforeEach(() => {
    deleteCalls = []
  })

  it("deleteMyData deletes rag_sources for the user", async () => {
    await deleteMyData("user_1")
    expect(deleteCalls).toContain(mockTables.ragSources)
  })

  it("deleteAccount deletes rag_sources for the user", async () => {
    await deleteAccount("user_1")
    expect(deleteCalls).toContain(mockTables.ragSources)
  })
})
