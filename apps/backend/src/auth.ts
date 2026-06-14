import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins/organization"
import { bearer } from "better-auth/plugins/bearer"
import { customSession } from "better-auth/plugins/custom-session"
import { db } from "@yomi/db"
import { eq } from "drizzle-orm"
import type { Context, Next } from "hono"
import * as authSchema from "./auth-schema.js"
import { effectivePlanForUser, effectiveRoleForUser, isOwnerUser } from "./entitlements.js"
import { grantCredits } from "./services/credit-ledger.js"
import { getPlan } from "@yomi/shared/plans"

const REGULAR_INTERACTION_LIMIT = 100
type AuthInstance = ReturnType<typeof createAuth>
let authInstance: AuthInstance | null = null

function getRuntimeAuthConfig() {
  const webOrigin = process.env["CORS_ORIGIN"] ?? process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000"
  const authBaseUrl = process.env["BETTER_AUTH_BASE_URL"] ?? webOrigin

  const authBaseHost = new URL(authBaseUrl).hostname
  const isSplitDomain = new URL(webOrigin).hostname !== authBaseHost

  const hostParts = authBaseHost.split(".")
  const cookieDomain =
    isSplitDomain && hostParts.length >= 3 ? `.${hostParts.slice(-3).join(".")}` : null

  const callbackBase = authBaseUrl.replace(/\/+$/, "")
  const googleRedirectUri = `${callbackBase}/api/auth/callback/google`
  const githubRedirectUri = `${callbackBase}/api/auth/callback/github`

  return { webOrigin, authBaseUrl, isSplitDomain, cookieDomain, googleRedirectUri, githubRedirectUri }
}

async function getUserFields(userId: string) {
  const [row] = await db
    .select({
      role: authSchema.user.role,
      plan: authSchema.user.plan,
      subscriptionStatus: authSchema.user.subscriptionStatus,
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
    trustedOrigins: [webOrigin, authBaseUrl].filter((origin, index, self) => self.indexOf(origin) === index),
    advanced,
    databaseHooks: {
      user: {
        create: {
          // Set role and plan right after Better Auth inserts the user row.
          after: async (createdUser) => {
            const isOwner = isOwnerUser(createdUser)

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
                expiresAt: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000),
                reason: "Explore monthly credits",
                metadata: { plan: "explore" },
              }).catch((err) => console.error("[signup] grantCredits failed:", createdUser.id, err))
            }
          },
        },
      },
    },
    plugins: [
      organization(), // Team tier: orgs + members + roles
      bearer(), // Accept Authorization: Bearer <token> from sidecar/landing proxy
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
          },
        }
      }),
    ],
    socialProviders: {
      google: {
        clientId: process.env["GOOGLE_CLIENT_ID"]!,
        clientSecret: process.env["GOOGLE_CLIENT_SECRET"]!,
        redirectURI: googleRedirectUri,
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
  return authInstance ??= createAuth()
}

export type SessionUser = AuthInstance["$Infer"]["Session"]["user"] & {
  role: string
  plan: string
  subscriptionStatus: string
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
}

// Hono middleware — validates Better Auth session (cookie or Bearer token)
export async function authenticate(c: Context, next: Next) {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  c.set("user", session.user as SessionUser)
  await next()
}

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser
  }
}
