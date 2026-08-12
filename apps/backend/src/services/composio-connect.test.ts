import { beforeEach, describe, expect, it, mock } from "bun:test"
import { encryptTokens, encryptString } from "./token-encryption.js"

// mock.module must run before composio-connect.js is first imported anywhere in
// this file (its top-level `import { db, mcpConnections } from "@yomi/db"` binds
// eagerly) — so composio-connect.js is imported dynamically, once, below, rather
// than via a static top-level import.
const dbState = { existingOauthTokens: null as string | null, upserts: 0 }

mock.module("@yomi/db", () => ({
  mcpConnections: { userId: "user_id", provider: "provider" },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            dbState.existingOauthTokens ? [{ oauthTokens: dbState.existingOauthTokens }] : [],
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

const { encodeComposioRef, decodeComposioRef, isRowConnected, markComposioConnectionActive } =
  await import("./composio-connect.js")

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  dbState.existingOauthTokens = null
  dbState.upserts = 0
})

describe("Composio connection reference", () => {
  it("round-trips a reference through encrypt/decrypt (no tokens stored)", () => {
    const blob = encodeComposioRef({
      kind: "composio",
      toolkit: "linear",
      connectedAccountId: "ca_123",
      status: "active",
    })
    // the stored blob must not contain plaintext account ids or the toolkit
    expect(blob).not.toContain("ca_123")
    expect(blob).not.toContain("linear")

    const ref = decodeComposioRef(blob)
    expect(ref).toEqual({
      kind: "composio",
      toolkit: "linear",
      connectedAccountId: "ca_123",
      status: "active",
    })
  })

  it("returns null for a native OAuth token blob (not a composio ref)", () => {
    const nativeBlob = encryptTokens({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now(),
    })
    expect(decodeComposioRef(nativeBlob)).toBeNull()
  })

  it("returns null for garbage input", () => {
    expect(decodeComposioRef("not-base64-or-encrypted")).toBeNull()
  })
})

describe("isRowConnected", () => {
  it("treats a native OAuth token blob as connected", () => {
    const nativeBlob = encryptTokens({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now(),
    })
    expect(isRowConnected(nativeBlob)).toBe(true)
  })

  it("treats an active Composio reference as connected", () => {
    const blob = encodeComposioRef({
      kind: "composio",
      toolkit: "gmail",
      connectedAccountId: "ca_123",
      status: "active",
    })
    expect(isRowConnected(blob)).toBe(true)
  })

  it("does not treat an initiated (never-completed) Composio reference as connected", () => {
    const blob = encodeComposioRef({
      kind: "composio",
      toolkit: "gmail",
      connectedAccountId: null,
      status: "initiated",
    })
    expect(isRowConnected(blob)).toBe(false)
  })
})

describe("markComposioConnectionActive — wasNewConnection", () => {
  const def = { id: "notion", auth: { kind: "composio", toolkit: "notion" } } as any

  it("is true when no row exists yet (first-ever connect)", async () => {
    const { wasNewConnection } = await markComposioConnectionActive("user_1", def, "ca_1")
    expect(wasNewConnection).toBe(true)
    expect(dbState.upserts).toBe(1)
  })

  it("is true when the existing row was only 'initiated', never active", async () => {
    dbState.existingOauthTokens = encryptString(
      JSON.stringify({
        kind: "composio",
        toolkit: "notion",
        connectedAccountId: null,
        status: "initiated",
      }),
    )
    const { wasNewConnection } = await markComposioConnectionActive("user_1", def, "ca_1")
    expect(wasNewConnection).toBe(true)
  })

  it("is false when the existing row was already active (reconnect/re-auth)", async () => {
    dbState.existingOauthTokens = encryptString(
      JSON.stringify({
        kind: "composio",
        toolkit: "notion",
        connectedAccountId: "ca_0",
        status: "active",
      }),
    )
    const { wasNewConnection } = await markComposioConnectionActive("user_1", def, "ca_1")
    expect(wasNewConnection).toBe(false)
  })
})
