import { Hono } from "hono"
import { db } from "@yomi/db"
import { eq } from "drizzle-orm"
import * as authSchema from "../auth-schema.js"
import { auth } from "../auth.js"

// Device-code flow for desktop OAuth (thin wrapper — Better Auth handles the heavy lifting)
// Standard OAuth2 device authorization grant (RFC 8628)
export const authRoutesRouter = new Hono()

// Initiate device-code flow: returns device_code, user_code, verification_uri
authRoutesRouter.post("/device-code", async (c) => {
  const { clientId } = (await c.req.json()) as { clientId: string }
  if (!clientId) return c.json({ error: "clientId required" }, 400)

  // Generate device code + user code pair
  const deviceCode = crypto.randomUUID()
  const userCode = Math.random().toString(36).slice(2, 8).toUpperCase()
  const expiresAt = Date.now() + 5 * 60 * 1000 // 5 min

  // Persist in Better Auth's secondary storage or a simple in-memory map
  // Phase 3: move to Redis; for now use in-memory
  pendingDeviceCodes.set(deviceCode, { userCode, clientId, expiresAt, token: null })

  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000"}/device`,
    expires_in: 300,
    interval: 5,
  })
})

// Desktop polls this to get the session token once the user has authenticated in the browser
authRoutesRouter.post("/device-code/token", async (c) => {
  const { device_code } = (await c.req.json()) as { device_code: string }
  const entry = pendingDeviceCodes.get(device_code)

  if (!entry) return c.json({ error: "invalid_grant" }, 400)
  if (Date.now() > entry.expiresAt) {
    pendingDeviceCodes.delete(device_code)
    return c.json({ error: "expired_token" }, 400)
  }
  if (!entry.token) {
    return c.json({ error: "authorization_pending" }, 400)
  }

  pendingDeviceCodes.delete(device_code)
  return c.json({ access_token: entry.token })
})

// Browser calls this after the user authenticates — links the session token to the device code
authRoutesRouter.post("/device-code/confirm", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Not authenticated" }, 401)

  const { user_code } = (await c.req.json()) as { user_code: string }
  const normalizedCode = user_code?.trim().toUpperCase()
  if (!normalizedCode) return c.json({ error: "user_code required" }, 400)

  let foundExpired = false
  for (const [deviceCode, entry] of pendingDeviceCodes) {
    if (entry.userCode !== normalizedCode) continue
    if (Date.now() >= entry.expiresAt) {
      foundExpired = true
      pendingDeviceCodes.delete(deviceCode)
      continue
    }

    {
      entry.token = session.session.token
      pendingDeviceCodes.set(deviceCode, entry)
      return c.json({ ok: true })
    }
  }

  if (foundExpired) return c.json({ error: "expired_user_code" }, 400)
  return c.json({ error: "invalid_user_code" }, 400)
})

// Sign-out from ALL devices — ensures signing out from the landing page also revokes
// the desktop session token. Call this AFTER Better Auth's own sign-out.
authRoutesRouter.post("/sign-out-all", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Not authenticated" }, 401)
  await db.delete(authSchema.session).where(eq(authSchema.session.userId, session.user.id))
  return c.json({ ok: true })
})

type PendingEntry = { userCode: string; clientId: string; expiresAt: number; token: string | null }
const pendingDeviceCodes = new Map<string, PendingEntry>()
