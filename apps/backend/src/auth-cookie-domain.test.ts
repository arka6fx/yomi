import { afterEach, describe, expect, it } from "bun:test"
import { getRuntimeAuthConfig } from "./auth.js"

const saved = {
  CORS_ORIGIN: process.env["CORS_ORIGIN"],
  BETTER_AUTH_BASE_URL: process.env["BETTER_AUTH_BASE_URL"],
  BETTER_AUTH_URL: process.env["BETTER_AUTH_URL"],
}

function setEnv(webOrigin: string, authBaseUrl?: string) {
  process.env["CORS_ORIGIN"] = webOrigin
  if (authBaseUrl) process.env["BETTER_AUTH_BASE_URL"] = authBaseUrl
  else delete process.env["BETTER_AUTH_BASE_URL"]
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe("auth cookie domain", () => {
  it("scopes the cookie to the domain the web and auth origins SHARE", () => {
    setEnv("https://getyomi.in", "https://api.getyomi.in")
    // Not `.api.getyomi.in` — getyomi.in could never read that, so Better Auth's
    // OAuth state cookie vanished and every sign-in failed with state_mismatch.
    expect(getRuntimeAuthConfig().cookieDomain).toBe(".getyomi.in")
  })

  it("handles a deeper auth subdomain", () => {
    setEnv("https://getyomi.in", "https://auth.api.getyomi.in")
    expect(getRuntimeAuthConfig().cookieDomain).toBe(".getyomi.in")
  })

  it("uses host-only cookies when both origins are the same host", () => {
    setEnv("https://getyomi.in", "https://getyomi.in")
    expect(getRuntimeAuthConfig().cookieDomain).toBeNull()
  })

  it("uses host-only cookies on localhost", () => {
    setEnv("http://localhost:3000", "http://localhost:3001")
    expect(getRuntimeAuthConfig().cookieDomain).toBeNull()
  })

  it("refuses to set a domain when the auth host is unrelated to the web origin", () => {
    setEnv("https://getyomi.in", "https://api.example.com")
    expect(getRuntimeAuthConfig().cookieDomain).toBeNull()
  })

  it("derives the OAuth redirect URIs from the auth base, not the web origin", () => {
    setEnv("https://getyomi.in", "https://api.getyomi.in")
    const cfg = getRuntimeAuthConfig()
    expect(cfg.googleRedirectUri).toBe("https://api.getyomi.in/api/auth/callback/google")
    expect(cfg.isSplitDomain).toBe(true)
  })
})
