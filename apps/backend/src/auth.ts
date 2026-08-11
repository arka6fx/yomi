import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins/organization"
import { bearer } from "better-auth/plugins/bearer"
import { customSession } from "better-auth/plugins/custom-session"
import { telegramWebAppAuth } from "./auth/telegram-webapp-plugin.js"
import { db } from "@yomi/db"
import { eq } from "drizzle-orm"
import type { Context, Next } from "hono"
import * as authSchema from "./auth-schema.js"
import { effectivePlanForUser, effectiveRoleForUser, isOwnerUser } from "./entitlements.js"
import { grantCredits } from "./services/credit-ledger.js"
import { recordConsentDecision } from "./services/privacy/consent.js"
import { getPlan } from "@yomi/shared/plans"
import { SIGNUP_DEFAULT_CONSENT_PURPOSES } from "@yomi/shared/privacy"

const REGULAR_INTERACTION_LIMIT = 100
type AuthInstance = ReturnType<typeof createAuth>
let authInstance: AuthInstance | null = null

export function getRuntimeAuthConfig() {
  const webOrigin =
    process.env["CORS_ORIGIN"] ?? process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000"
  const authBaseUrl = process.env["BETTER_AUTH_BASE_URL"] ?? webOrigin

  const authBaseHost = new URL(authBaseUrl).hostname
  const webOriginHost = new URL(webOrigin).hostname
  const isSplitDomain = webOriginHost !== authBaseHost

  // The cookie must be readable from BOTH the web origin and the auth origin, so
  // it has to be scoped to the domain they share — for getyomi.in +
  // api.getyomi.in that is `.getyomi.in`. Deriving it from the auth host's own
  // labels yielded `.api.getyomi.in`, which the web origin can never read, so
  // Better Auth's OAuth state cookie went missing and every sign-in died with
  // `state_mismatch`. Only set a domain when the auth host really is a subdomain
  // of the web origin; anything else (localhost, unrelated hosts) gets host-only
  // cookies.
  const cookieDomain =
    isSplitDomain && authBaseHost.endsWith(`.${webOriginHost}`) ? `.${webOriginHost}` : null

  const callbackBase = authBaseUrl.replace(/\/+$/, "")
  const googleRedirectUri = `${callbackBase}/api/auth/callback/google`
  const githubRedirectUri = `${callbackBase}/api/auth/callback/github`

  return {
    webOrigin,
    authBaseUrl,
    isSplitDomain,
    cookieDomain,
    googleRedirectUri,
    githubRedirectUri,
  }
}

async function getUserFields(userId: string) {
  const [row] = await db
    .select({
      role: authSchema.user.role,
      plan: authSchema.user.plan,
      subscriptionStatus: authSchema.user.subscriptionStatus,
      trialStartDate: authSchema.user.trialStartDate,
      trialEndDate: authSchema.user.trialEndDate,
      currentPeriodEnd: authSchema.user.currentPeriodEnd,
      dodoCustomerId: authSchema.user.dodoCustomerId,
      dodoSubscriptionId: authSchema.user.dodoSubscriptionId,
      trialInteractionUsed: authSchema.user.trialInteractionUsed,
      trialInteractionLimit: authSchema.user.trialInteractionLimit,
      dailyChatCount: authSchema.user.dailyChatCount,
      dailyVoiceCount: authSchema.user.dailyVoiceCount,
      dailyImageCount: authSchema.user.dailyImageCount,
      agentUsageCount: authSchema.user.agentUsageCount,
      dailyResetDate: authSchema.user.dailyResetDate,
      deletedAt: authSchema.user.deletedAt,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  return row ?? null
}

function createAuth() {
  const { webOrigin, authBaseUrl, cookieDomain, googleRedirectUri, githubRedirectUri } =
    getRuntimeAuthConfig()

  const advanced: Record<string, unknown> = {}
  if (cookieDomain) {
    advanced.crossSubDomainCookies = { enabled: true, domain: cookieDomain }
  }

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    baseURL: webOrigin,
    trustedOrigins: [webOrigin, authBaseUrl].filter(
      (origin, index, self) => self.indexOf(origin) === index,
    ),
    advanced,
    databaseHooks: {
      user: {
        create: {
          // Set role and plan right after Better Auth inserts the user row.
          after: async (createdUser) => {
            const isOwner = isOwnerUser(createdUser)
            const trialStartDate = new Date()
            const trialEndDate = new Date(trialStartDate.getTime() + 30 * 24 * 60 * 60 * 1000)

            await db
              .update(authSchema.user)
              .set(
                isOwner
                  ? { role: "owner", plan: "max", subscriptionStatus: "active" }
                  : {
                      role: "user",
                      plan: "explore",
                      subscriptionStatus: "inactive",
                      trialInteractionLimit: REGULAR_INTERACTION_LIMIT,
                      trialStartDate,
                      trialEndDate,
                    },
              )
              .where(eq(authSchema.user.id, createdUser.id))

            if (!isOwner) {
              const plan = getPlan("explore")
              await grantCredits({
                userId: createdUser.id,
                amount: plan.includedCredits,
                source: "subscription_cycle",
                sourceId: `signup:${createdUser.id}:explore`,
                idempotencyKey: `signup:${createdUser.id}:explore_credits`,
                expiresAt: trialEndDate,
                reason: "Explore trial credits",
                metadata: { plan: "explore", trialDays: 30 },
              }).catch((err) => console.error("[signup] grantCredits failed:", createdUser.id, err))
            }

            // Seed the functional consent subset so chat/memory/connectors work
            // on first use. This records a real granted-consent decision (not a
            // silent pre-tick) that the user can revoke from the dashboard.
            await recordConsentDecision({
              userId: createdUser.id,
              purposes: [...SIGNUP_DEFAULT_CONSENT_PURPOSES],
              status: "granted",
              context: {
                appVersion: null,
                ipAddress: null,
                userAgent: null,
                metadata: { source: "signup_default" },
              },
            }).catch((err) => console.error("[signup] consent seed failed:", createdUser.id, err))
          },
        },
      },
    },
    plugins: [
      organization(), // Team tier: orgs + members + roles
      bearer(), // Accept Authorization: Bearer <token> from landing proxy
      telegramWebAppAuth(), // POST /api/auth/telegram-webapp-auth — Mini App auto-login
      customSession(async (session) => {
        const fields = await getUserFields(session.user.id)
        const mergedUser = { ...session.user, ...(fields ?? {}) }
        return {
          ...session,
          user: {
            ...session.user,
            role: effectiveRoleForUser(mergedUser),
            plan: effectivePlanForUser(mergedUser),
            subscriptionStatus: fields?.subscriptionStatus ?? "inactive",
            trialStartDate: fields?.trialStartDate ?? null,
            trialEndDate: fields?.trialEndDate ?? null,
            currentPeriodEnd: fields?.currentPeriodEnd ?? null,
            dodoCustomerId: fields?.dodoCustomerId ?? null,
            dodoSubscriptionId: fields?.dodoSubscriptionId ?? null,
            trialInteractionUsed: fields?.trialInteractionUsed ?? 0,
            trialInteractionLimit: fields?.trialInteractionLimit ?? REGULAR_INTERACTION_LIMIT,
            dailyChatCount: fields?.dailyChatCount ?? 0,
            dailyVoiceCount: fields?.dailyVoiceCount ?? 0,
            dailyImageCount: fields?.dailyImageCount ?? 0,
            agentUsageCount: fields?.agentUsageCount ?? 0,
            dailyResetDate: fields?.dailyResetDate ?? null,
            deletedAt: fields?.deletedAt ?? null,
          },
        }
      }),
    ],
    socialProviders: {
      google: {
        clientId: process.env["GOOGLE_CLIENT_ID"]!,
        clientSecret: process.env["GOOGLE_CLIENT_SECRET"]!,
        redirectURI: googleRedirectUri,
        prompt: "select_account",
      },
      github: {
        clientId: process.env["GITHUB_CLIENT_ID"]!,
        clientSecret: process.env["GITHUB_CLIENT_SECRET"]!,
        redirectURI: githubRedirectUri,
      },
    },
  })
}

export function getAuth() {
  return (authInstance ??= createAuth())
}

export type SessionUser = AuthInstance["$Infer"]["Session"]["user"] & {
  role: string
  plan: string
  subscriptionStatus: string
  trialStartDate: Date | null
  trialEndDate: Date | null
  currentPeriodEnd: Date | null
  dodoCustomerId: string | null
  dodoSubscriptionId: string | null
  trialInteractionUsed: number
  trialInteractionLimit: number
  dailyChatCount: number
  dailyVoiceCount: number
  dailyImageCount: number
  agentUsageCount: number
  dailyResetDate: string | null
  deletedAt: Date | null
  agentSoul: string | null
}

// Hono middleware — validates Better Auth session (cookie or Bearer token)
export async function authenticate(c: Context, next: Next) {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const user = session.user as SessionUser
  // Soft-deleted accounts must stay locked out even if the OAuth provider
  // mints a fresh session — deletion is one-way until retention hard-deletes.
  if (user.deletedAt) {
    return c.json({ error: "Account deleted", code: "account_deleted" }, 401)
  }
  c.set("user", user)
  await next()
}

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser
  }
}
