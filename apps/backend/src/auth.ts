import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins/organization"
import { bearer } from "better-auth/plugins/bearer"
import { customSession } from "better-auth/plugins/custom-session"
import { db } from "@yomi/db"
import { eq } from "drizzle-orm"
import type { Context, Next } from "hono"
import * as authSchema from "./auth-schema.js"

const TRIAL_DAYS = 30

async function getUserFields(userId: string) {
  const [row] = await db
    .select({
      role:               authSchema.user.role,
      plan:               authSchema.user.plan,
      subscriptionStatus: authSchema.user.subscriptionStatus,
      trialEndDate:       authSchema.user.trialEndDate,
      currentPeriodEnd:   authSchema.user.currentPeriodEnd,
      razorpayCustomerId: authSchema.user.razorpayCustomerId,
      dailyChatCount:     authSchema.user.dailyChatCount,
      dailyVoiceCount:    authSchema.user.dailyVoiceCount,
      dailyImageCount:    authSchema.user.dailyImageCount,
      agentUsageCount:    authSchema.user.agentUsageCount,
      dailyResetDate:     authSchema.user.dailyResetDate,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  return row ?? null
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  baseURL: process.env["BETTER_AUTH_BASE_URL"] ?? "http://localhost:3001",
  trustedOrigins: [process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000"],
  databaseHooks: {
    user: {
      create: {
        // Set role, plan, and trial dates right after the user row is inserted
        after: async (createdUser) => {
          const ownerEmail = process.env["OWNER_EMAIL"]
          const isOwner = !!ownerEmail && createdUser.email === ownerEmail
          const now = new Date()
          const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)

          await db
            .update(authSchema.user)
            .set(
              isOwner
                ? { role: "owner", plan: "max", subscriptionStatus: "active" }
                : { role: "user", plan: "explore", subscriptionStatus: "inactive", trialStartDate: now, trialEndDate: trialEnd },
            )
            .where(eq(authSchema.user.id, createdUser.id))
        },
      },
    },
  },
  plugins: [
    organization(),  // Team tier: orgs + members + roles
    bearer(),        // Accept Authorization: Bearer <token> from sidecar/landing proxy
    customSession(async (session) => {
      const fields = await getUserFields(session.user.id)
      return {
        ...session,
        user: {
          ...session.user,
          role:               fields?.role               ?? "user",
          plan:               fields?.plan               ?? "explore",
          subscriptionStatus: fields?.subscriptionStatus ?? "inactive",
          trialEndDate:       fields?.trialEndDate       ?? null,
          currentPeriodEnd:   fields?.currentPeriodEnd   ?? null,
          razorpayCustomerId: fields?.razorpayCustomerId ?? null,
          dailyChatCount:     fields?.dailyChatCount      ?? 0,
          dailyVoiceCount:    fields?.dailyVoiceCount     ?? 0,
          dailyImageCount:    fields?.dailyImageCount     ?? 0,
          agentUsageCount:    fields?.agentUsageCount     ?? 0,
          dailyResetDate:     fields?.dailyResetDate      ?? null,
        },
      }
    }),
  ],
  socialProviders: {
    google: {
      clientId: process.env["GOOGLE_CLIENT_ID"]!,
      clientSecret: process.env["GOOGLE_CLIENT_SECRET"]!,
    },
    github: {
      clientId: process.env["GITHUB_CLIENT_ID"]!,
      clientSecret: process.env["GITHUB_CLIENT_SECRET"]!,
    },
  },
})

export type SessionUser = typeof auth.$Infer.Session.user & {
  role:               string
  plan:               string
  subscriptionStatus: string
  trialEndDate:       Date | null
  currentPeriodEnd:   Date | null
  razorpayCustomerId: string | null
  dailyChatCount:     number
  dailyVoiceCount:    number
  dailyImageCount:    number
  agentUsageCount:    number
  dailyResetDate:     string | null
}

// Hono middleware — validates Better Auth session (cookie or Bearer token)
export async function authenticate(c: Context, next: Next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
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
