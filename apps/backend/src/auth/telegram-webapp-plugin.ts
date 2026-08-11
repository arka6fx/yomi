import { createHmac, timingSafeEqual } from "node:crypto"
import { createAuthEndpoint, APIError } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"
import { db, platformConnections } from "@yomi/db"
import { eq, and } from "drizzle-orm"

// Telegram recommends treating initData as stale past a short window — this
// is a Mini App auto-login, not a long-lived credential, so 24 hours is
// generous rather than tight.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60

// Verifies a Telegram Mini App's initData per Telegram's documented algorithm:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// Never trusts the payload's own claims (including the user id) until the HMAC
// signature — keyed by the bot token, which only this backend and Telegram
// know — checks out.
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
): { telegramUserId: string } | null {
  const params = new URLSearchParams(initData)
  const hash = params.get("hash")
  if (!hash) return null
  params.delete("hash")

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest()
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex")

  let hashesMatch: boolean
  try {
    hashesMatch = timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(hash, "hex"))
  } catch {
    // Buffer.from throws on a malformed (non-hex or wrong-length) hash — not a match.
    hashesMatch = false
  }
  if (!hashesMatch) return null

  const authDate = Number(params.get("auth_date"))
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) return null

  const userRaw = params.get("user")
  if (!userRaw) return null
  try {
    const user = JSON.parse(userRaw) as { id?: number }
    if (typeof user.id !== "number") return null
    return { telegramUserId: String(user.id) }
  } catch {
    return null
  }
}

// Pulled out from the endpoint below so it's testable without spinning up a
// full Better Auth request context — it's a plain DB lookup.
export async function resolveTelegramWebAppUserId(telegramUserId: string): Promise<string | null> {
  const [connection] = await db
    .select({ userId: platformConnections.userId })
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.platform, "telegram"),
        eq(platformConnections.platformUserId, telegramUserId),
      ),
    )
    .limit(1)
  return connection?.userId ?? null
}

// Lets the Telegram Mini App dashboard (apps/landing's /telegram-app) sign a
// user in automatically instead of running a full OAuth flow inside Telegram's
// in-app browser. Registers POST /api/auth/telegram-webapp-auth.
export const telegramWebAppAuth = () => ({
  id: "telegram-webapp-auth",
  endpoints: {
    telegramWebAppAuth: createAuthEndpoint(
      "/telegram-webapp-auth",
      { method: "POST", body: z.object({ initData: z.string().min(1) }) },
      async (ctx) => {
        const botToken = process.env["TELEGRAM_BOT_TOKEN"]
        if (!botToken) {
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "Telegram not configured" })
        }

        const verified = verifyTelegramInitData(ctx.body.initData, botToken)
        if (!verified) {
          throw new APIError("UNAUTHORIZED", { message: "Invalid Telegram signature" })
        }

        const userId = await resolveTelegramWebAppUserId(verified.telegramUserId)
        if (!userId) return ctx.json({ ok: true, linked: false })

        const user = await ctx.context.internalAdapter.findUserById(userId)
        if (!user) return ctx.json({ ok: true, linked: false })

        const session = await ctx.context.internalAdapter.createSession(userId)
        if (!session) {
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" })
        }

        await setSessionCookie(ctx, { session, user })
        return ctx.json({ ok: true, linked: true })
      },
    ),
  },
})
