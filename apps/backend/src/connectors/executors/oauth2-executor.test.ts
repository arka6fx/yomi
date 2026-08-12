import { beforeEach, describe, expect, it, mock } from "bun:test"

const dbState = { existingRow: null as { id: string } | null, upserts: 0 }

mock.module("@yomi/db", () => ({
  mcpConnections: { userId: "user_id", provider: "provider", id: "id" },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (dbState.existingRow ? [dbState.existingRow] : []),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => {
          dbState.upserts++
        },
      }),
    }),
  },
}))

const { storeApiKeyCredential } = await import("./oauth2-executor.js")

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "03f5c50ad7461b5172d57041fef789cc7297c9bfd806a52eecba14e03201d040"
  dbState.existingRow = null
  dbState.upserts = 0
})

describe("storeApiKeyCredential — wasNewConnection", () => {
  const def = {
    id: "context7",
    name: "Context7",
    auth: { kind: "api_key", fields: [{ name: "api_key" }] },
  } as any

  it("is true when no row exists yet", async () => {
    const { wasNewConnection } = await storeApiKeyCredential(def, "user_1", { api_key: "k" })
    expect(wasNewConnection).toBe(true)
    expect(dbState.upserts).toBe(1)
  })

  it("is false when a row already exists (key rotation, not a first connect)", async () => {
    dbState.existingRow = { id: "row_1" }
    const { wasNewConnection } = await storeApiKeyCredential(def, "user_1", { api_key: "new-key" })
    expect(wasNewConnection).toBe(false)
  })
})
