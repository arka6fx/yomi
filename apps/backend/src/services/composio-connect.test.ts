import { beforeEach, describe, expect, it } from "bun:test"
import { encodeComposioRef, decodeComposioRef, isRowConnected } from "./composio-connect.js"
import { encryptTokens } from "./token-encryption.js"

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
