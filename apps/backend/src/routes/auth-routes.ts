import { Hono } from "hono"
import { db } from "@yomi/db"
import { deviceCodes } from "@yomi/db"
import { eq, lt } from "drizzle-orm"
import * as authSchema from "../auth-schema.js"
import { getAuth } from "../auth.js"

// Device-code flow for desktop OAuth (RFC 8628)
// Codes persisted in DB so all CF Worker isolates share state.
export const authRoutesRouter = new Hono()

authRoutesRouter.use("*", (c, next) => {
  console.log("[auth-routes] handling:", c.req.method, c.req.path)
  return next()
})

// Initiate device-code flow: returns device_code, user_code, verification_uri
authRoutesRouter.post("/device-code", async (c) => {
  const { clientId } = (await c.req.json()) as { clientId: string }
  if (!clientId) return c.json({ error: "clientId required" }, 400)

  const deviceCode = crypto.randomUUID()
  const userCode = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

  // Prune expired codes opportunistically to keep the table small
  await db
    .delete(deviceCodes)
    .where(lt(deviceCodes.expiresAt, new Date()))
    .catch(() => {})

  await db.insert(deviceCodes).values({ deviceCode, userCode, clientId, expiresAt })

  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${process.env["NEXT_PUBLIC_APP_URL"] ?? "https://getyomi.in"}/device`,
    expires_in: 300,
    interval: 5,
  })
})

// Desktop polls this to get the session token once the user has authenticated in the browser
authRoutesRouter.post("/device-code/token", async (c) => {
  const { device_code } = (await c.req.json()) as { device_code: string }

  const entry = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.deviceCode, device_code))
    .limit(1)
    .then((r) => r[0] ?? null)

  if (!entry) return c.json({ error: "invalid_grant" }, 400)

  if (Date.now() > entry.expiresAt.getTime()) {
    await db
      .delete(deviceCodes)
      .where(eq(deviceCodes.deviceCode, device_code))
      .catch(() => {})
    return c.json({ error: "expired_token" }, 400)
  }

  if (!entry.token) return c.json({ error: "authorization_pending" }, 400)

  await db
    .delete(deviceCodes)
    .where(eq(deviceCodes.deviceCode, device_code))
    .catch(() => {})
  return c.json({ access_token: entry.token })
})

// Browser calls this after the user authenticates — links the session token to the device code
authRoutesRouter.post("/device-code/confirm", async (c) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Not authenticated" }, 401)

  const { user_code } = (await c.req.json()) as { user_code: string }
  const normalizedCode = user_code?.trim().toUpperCase()
  if (!normalizedCode) return c.json({ error: "user_code required" }, 400)

  const entry = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.userCode, normalizedCode))
    .limit(1)
    .then((r) => r[0] ?? null)

  if (!entry) return c.json({ error: "invalid_user_code" }, 400)

  if (Date.now() >= entry.expiresAt.getTime()) {
    await db
      .delete(deviceCodes)
      .where(eq(deviceCodes.userCode, normalizedCode))
      .catch(() => {})
    return c.json({ error: "expired_user_code" }, 400)
  }

  await db
    .update(deviceCodes)
    .set({ token: session.session.token })
    .where(eq(deviceCodes.userCode, normalizedCode))

  return c.json({ ok: true })
})

// Sign-out from ALL devices — revokes the desktop session token too
authRoutesRouter.post("/sign-out-all", async (c) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Not authenticated" }, 401)
  await db.delete(authSchema.session).where(eq(authSchema.session.userId, session.user.id))
  return c.json({ ok: true })
})
