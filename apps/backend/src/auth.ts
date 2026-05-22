import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins/organization"
import { bearer } from "better-auth/plugins/bearer"
import { customSession } from "better-auth/plugins/custom-session"
import { db, subscriptions } from "@yomi/db"
import { eq } from "drizzle-orm"
import type { Context, Next } from "hono"

async function getUserPlan(userId: string): Promise<string> {
  const [sub] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1)
  if (!sub || sub.status !== "active") return "free"
  return sub.plan
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  plugins: [
    organization(),  // Team tier: orgs + members + roles
    bearer(),        // Accept Authorization: Bearer <token> from sidecar
    customSession(async (session) => ({
      ...session,
      user: { ...session.user, plan: await getUserPlan(session.user.id) },
    })),
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

type SessionUser = typeof auth.$Infer.Session.user & { plan: string }

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
