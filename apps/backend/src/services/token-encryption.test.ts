import { afterEach, describe, expect, it } from "bun:test"
import { encryptTokens, decryptTokens, type OAuthTokens } from "./token-encryption.js"

const KEY_A = "a".repeat(64)
const KEY_B = "b".repeat(64)
const KEY_C = "c".repeat(64)

const sample: OAuthTokens = {
  accessToken: "access-123",
  refreshToken: "refresh-456",
  expiresAt: 1_700_000_000_000,
  tokenType: "Bearer",
  scope: "drive.file",
}

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("token-encryption multi-key decryption", () => {
  it("round-trips with a single key", () => {
    process.env.ENCRYPTION_KEY = KEY_A
    delete process.env.ENCRYPTION_KEY_FALLBACKS
    expect(decryptTokens(encryptTokens(sample))).toEqual(sample)
  })

  it("decrypts a token written under a now-fallback key", () => {
    // Token encrypted in "environment A" (primary KEY_A)
    process.env.ENCRYPTION_KEY = KEY_A
    delete process.env.ENCRYPTION_KEY_FALLBACKS
    const ciphertext = encryptTokens(sample)

    // Read in "environment B": primary KEY_B, KEY_A only as a fallback
    process.env.ENCRYPTION_KEY = KEY_B
    process.env.ENCRYPTION_KEY_FALLBACKS = KEY_A
    expect(decryptTokens(ciphertext)).toEqual(sample)
  })

  it("supports multiple comma-separated fallback keys", () => {
    process.env.ENCRYPTION_KEY = KEY_C
    delete process.env.ENCRYPTION_KEY_FALLBACKS
    const ciphertext = encryptTokens(sample)

    process.env.ENCRYPTION_KEY = KEY_A
    process.env.ENCRYPTION_KEY_FALLBACKS = `${KEY_B}, ${KEY_C}`
    expect(decryptTokens(ciphertext)).toEqual(sample)
  })

  it("throws when no key matches", () => {
    process.env.ENCRYPTION_KEY = KEY_A
    const ciphertext = encryptTokens(sample)

    process.env.ENCRYPTION_KEY = KEY_B
    process.env.ENCRYPTION_KEY_FALLBACKS = KEY_C
    expect(() => decryptTokens(ciphertext)).toThrow()
  })

  it("ignores malformed fallback entries", () => {
    process.env.ENCRYPTION_KEY = KEY_A
    delete process.env.ENCRYPTION_KEY_FALLBACKS
    const ciphertext = encryptTokens(sample)

    process.env.ENCRYPTION_KEY = KEY_B
    process.env.ENCRYPTION_KEY_FALLBACKS = `not-hex, ${KEY_A}`
    expect(decryptTokens(ciphertext)).toEqual(sample)
  })
})
