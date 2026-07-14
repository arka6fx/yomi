import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Hono } from "hono"
import { isSpeechAuthorized } from "./speech-auth.js"

const originalEnv = { ...process.env }

beforeEach(() => {
  delete process.env["SIDECAR_SECRET"]
  delete process.env["NODE_ENV"]
})

afterEach(() => {
  process.env = { ...originalEnv }
})

// 200 when authorized, 401 when not — mirrors how stt.ts/tts.ts gate their handlers.
function probe(headers: Record<string, string> = {}) {
  const app = new Hono().post("/", (c) =>
    isSpeechAuthorized(c) ? c.json({ ok: true }) : c.json({ error: "Unauthorized" }, 401),
  )
  return app.request("/", { method: "POST", headers })
}

describe("speech route authorization", () => {
  it("accepts the sidecar shared secret", async () => {
    process.env["SIDECAR_SECRET"] = "s3cret"
    expect((await probe({ "x-sidecar-secret": "s3cret" })).status).toBe(200)
  })

  it("rejects a wrong secret", async () => {
    process.env["SIDECAR_SECRET"] = "s3cret"
    expect((await probe({ "x-sidecar-secret": "nope" })).status).toBe(401)
  })

  it("rejects a caller presenting no secret", async () => {
    process.env["SIDECAR_SECRET"] = "s3cret"
    expect((await probe()).status).toBe(401)
  })

  // Regression guard: the old check compared the header against an undefined secret, so an
  // anonymous caller matched and both speech routes became open relays. Losing SIDECAR_SECRET
  // on the box must fail closed, not fail open.
  it("fails closed in production when no secret is configured", async () => {
    process.env["NODE_ENV"] = "production"
    expect((await probe()).status).toBe(401)
  })

  it("allows an unconfigured local backend outside production", async () => {
    expect((await probe()).status).toBe(200)
  })
})
