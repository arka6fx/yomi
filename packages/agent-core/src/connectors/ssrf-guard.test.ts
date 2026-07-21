import { describe, expect, it, mock } from "bun:test"
import { isBlockedIPv4, isBlockedIPv6, resolvesToDisallowedAddress } from "./ssrf-guard.js"

describe("isBlockedIPv4", () => {
  it("blocks the EC2/cloud metadata address", () => {
    expect(isBlockedIPv4("169.254.169.254")).toBe(true)
  })

  it("blocks loopback", () => {
    expect(isBlockedIPv4("127.0.0.1")).toBe(true)
  })

  it("blocks RFC1918 private ranges", () => {
    expect(isBlockedIPv4("10.1.2.3")).toBe(true)
    expect(isBlockedIPv4("172.16.5.1")).toBe(true)
    expect(isBlockedIPv4("192.168.1.1")).toBe(true)
  })

  it("blocks 0.0.0.0", () => {
    expect(isBlockedIPv4("0.0.0.0")).toBe(true)
  })

  it("allows a real public address", () => {
    expect(isBlockedIPv4("8.8.8.8")).toBe(false)
  })

  it("does not block an address just outside a private range", () => {
    // 172.16.0.0/12 covers 172.16.0.0-172.31.255.255 — 172.32.0.0 is public
    expect(isBlockedIPv4("172.32.0.1")).toBe(false)
  })
})

describe("isBlockedIPv6", () => {
  it("blocks loopback", () => {
    expect(isBlockedIPv6("::1")).toBe(true)
  })

  it("blocks link-local", () => {
    expect(isBlockedIPv6("fe80::1")).toBe(true)
  })

  it("blocks unique-local", () => {
    expect(isBlockedIPv6("fd00::1")).toBe(true)
  })

  it("blocks an IPv4-mapped private address", () => {
    expect(isBlockedIPv6("::ffff:127.0.0.1")).toBe(true)
  })

  it("allows a real public address", () => {
    expect(isBlockedIPv6("2001:4860:4860::8888")).toBe(false)
  })
})

// A single mock.module registration, read from mutable state set per-test —
// bun test doesn't isolate module mocks per file in this repo (no --isolate
// in the package's test script), and repeatedly re-registering mock.module
// for the same specifier across sequential tests is unreliable. One
// registration + mutable state (matching apps/backend's billing.test.ts
// pattern) sidesteps that entirely.
let mockLookup: () => Promise<{ address: string; family: number }[]> = async () => []
mock.module("node:dns", () => ({
  promises: {
    lookup: () => mockLookup(),
  },
}))

describe("resolvesToDisallowedAddress", () => {
  it("checks a literal IPv4 address without a DNS lookup", async () => {
    expect(await resolvesToDisallowedAddress("169.254.169.254")).toBe(true)
    expect(await resolvesToDisallowedAddress("8.8.8.8")).toBe(false)
  })

  it("blocks a hostname that resolves to a private address", async () => {
    mockLookup = async () => [{ address: "127.0.0.1", family: 4 }]
    expect(await resolvesToDisallowedAddress("internal.example.com")).toBe(true)
  })

  it("allows a hostname that resolves to a public address", async () => {
    mockLookup = async () => [{ address: "8.8.8.8", family: 4 }]
    expect(await resolvesToDisallowedAddress("public.example.com")).toBe(false)
  })

  it("fails closed when DNS resolution errors", async () => {
    mockLookup = async () => {
      throw new Error("ENOTFOUND")
    }
    expect(await resolvesToDisallowedAddress("nonexistent.example.invalid")).toBe(true)
  })
})
