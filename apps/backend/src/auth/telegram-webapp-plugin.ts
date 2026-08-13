import { randomBytes, createHmac, timingSafeEqual } from "node:crypto"
import { createAuthEndpoint, APIError } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"
import { db, platformConnections, telegramMiniappLoginTokens } from "@yomi/db"
import { eq, and, isNull, gt } from "drizzle-orm"

// Telegram recommends treating initData as stale past a short window — this
// is a Mini App auto-login, not a long-lived credential, so 24 hours is
// generous rather than tight.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60

// A login token is a bridge between Telegram's embedded webview and a real
// external browser — see docs/superpowers/specs/2026-08-12-telegram-miniapp-dashboard-handoff-design.md.
// Kept short: long enough to cover the user tapping through, short enough to
// bound exposure if the URL somehow leaked.
const LOGIN_TOKEN_TTL_MS = 2 * 60 * 1000

function webOrigin(): string {
  return process.env["CORS_ORIGIN"] ?? "https://getyomi.in"
}

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
    // Buffer.from silently truncates malformed hex rather than throwing; it's
    // timingSafeEqual that throws when the two buffers end up different
    // lengths — either way, that means no match.
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

// Pulled out from the endpoint below for the same reason as claimLoginToken:
// mints a single-use token row and the redeem URL that wraps it, without
// needing a full Better Auth request context to test against. baseURL is
// threaded in explicitly (rather than read off ctx.context.baseURL) so this
// stays a plain function of its inputs.
export async function mintLoginToken(
  userId: string,
  baseURL: string,
): Promise<{ redeemUrl: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS)
  await db.insert(telegramMiniappLoginTokens).values({ token, userId, expiresAt })
  return { redeemUrl: `${baseURL}/telegram-webapp-redeem?token=${token}`, expiresAt }
}

// Atomically claims a login token: a single UPDATE ... WHERE ... RETURNING,
// not a separate read-then-write, so a raced double-redemption (e.g. a
// double-tap that fires two requests) can't claim the same token twice.
// Returns the token's userId on a successful claim, null if the token is
// missing, already used, or expired — all three collapse to the same
// "start over" outcome from the caller's side.
export async function claimLoginToken(token: string): Promise<string | null> {
  const [claimed] = await db
    .update(telegramMiniappLoginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(telegramMiniappLoginTokens.token, token),
        isNull(telegramMiniappLoginTokens.usedAt),
        gt(telegramMiniappLoginTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: telegramMiniappLoginTokens.userId })
  return claimed?.userId ?? null
}

// Lets the Telegram Mini App dashboard (apps/landing's /telegram-app) sign a
// user in automatically instead of running a full OAuth flow inside Telegram's
// in-app browser. Registers:
//   POST /api/auth/telegram-webapp-auth   — verify initData, mint a redeem URL
//   GET  /api/auth/telegram-webapp-redeem — claim the token, mint a real
//                                            session, redirect to /dashboard
// The two are split because they run in different browser contexts: the POST
// runs inside Telegram's own embedded webview (which is why it can't just set
// a cookie and be done — that cookie would never reach a real external
// browser), the GET runs in the external browser Telegram.WebApp.openLink()
// opens, which is where the session actually needs to live.
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

        const { redeemUrl } = await mintLoginToken(userId, ctx.context.baseURL)

        return ctx.json({ ok: true, linked: true, redeemUrl })
      },
    ),
    telegramWebAppRedeem: createAuthEndpoint(
      "/telegram-webapp-redeem",
      { method: "GET", query: z.object({ token: z.string().min(1) }) },
      async (ctx) => {
        const userId = await claimLoginToken(ctx.query.token)
        if (!userId) {
          throw ctx.redirect(`${webOrigin()}/signin?error=expired_link`)
        }

        const user = await ctx.context.internalAdapter.findUserById(userId)
        if (!user) {
          throw ctx.redirect(`${webOrigin()}/signin?error=expired_link`)
        }

        const session = await ctx.context.internalAdapter.createSession(userId)
        if (!session) {
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" })
        }

        await setSessionCookie(ctx, { session, user })
        throw ctx.redirect(`${webOrigin()}/dashboard`)
      },
    ),
  },
})
