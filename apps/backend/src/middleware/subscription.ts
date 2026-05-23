import { sql } from "drizzle-orm"
import { eq } from "drizzle-orm"
import type { Context, Next } from "hono"
import { db } from "@yomi/db"
import * as authSchema from "../auth-schema.js"

export type AccessKind = "chat" | "voice" | "image" | "agent"

// Daily limits by plan — owners bypass this entirely
const DAILY_LIMITS: Record<string, Record<AccessKind, number>> = {
  explore: { chat: 50,    voice: 10,    image: 10,    agent: 0 },
  pro:     { chat: 10000, voice: 200,   image: 200,   agent: 0 },
  max:     { chat: 10000, voice: 10000, image: 10000, agent: 10000 },
}

function todayUtc(): string {
  return new Date().toISOString().split("T")[0]!
}

function isTrialActive(user: { plan: string; subscriptionStatus: string; trialEndDate: Date | null }): boolean {
  if (user.plan !== "explore") return true
  if (!user.trialEndDate) return false
  return new Date() < user.trialEndDate
}

function isSubscriptionActive(user: {
  plan: string
  subscriptionStatus: string
  trialEndDate: Date | null
}): boolean {
  if (user.plan === "explore") return isTrialActive(user)
  return user.subscriptionStatus === "active"
}

// Factory: returns Hono middleware that checks access for the given kind of action
export function requireAccess(kind: AccessKind) {
  return async (c: Context, next: Next) => {
    const user = c.get("user")

    // Owners bypass everything
    if (user.role === "owner") return next()

    // Subscription / trial gate
    if (!isSubscriptionActive(user)) {
      const expired = user.plan === "explore" && user.trialEndDate && new Date() >= user.trialEndDate
      return c.json(
        {
          error: expired ? "Free trial expired — please upgrade" : "Subscription required",
          code: expired ? "trial_expired" : "subscription_required",
        },
        403,
      )
    }

    // Agent access requires max plan
    if (kind === "agent" && user.plan !== "max") {
      return c.json({ error: "Yomi Max required for agents", code: "upgrade_required" }, 403)
    }

    // Daily rate limit
    const limits = DAILY_LIMITS[user.plan] ?? DAILY_LIMITS.explore!
    const limit = limits[kind]!
    const today = todayUtc()
    const needsReset = user.dailyResetDate !== today
    const currentCount = needsReset ? 0 : getDailyCount(user, kind)

    if (currentCount >= limit) {
      return c.json({ error: "Daily limit reached", code: "rate_limited" }, 429)
    }

    // Increment counter (async — don't block the response)
    incrementCount(user.id, kind, needsReset, today).catch(() => {})

    await next()
  }
}

function getDailyCount(
  user: { dailyChatCount: number; dailyVoiceCount: number; dailyImageCount: number; agentUsageCount: number },
  kind: AccessKind,
): number {
  switch (kind) {
    case "chat":  return user.dailyChatCount
    case "voice": return user.dailyVoiceCount
    case "image": return user.dailyImageCount
    case "agent": return user.agentUsageCount
  }
}

async function incrementCount(userId: string, kind: AccessKind, reset: boolean, today: string) {
  if (reset) {
    // New UTC day — zero all counters and start fresh
    await db.update(authSchema.user).set({
      dailyChatCount:  kind === "chat"  ? 1 : 0,
      dailyVoiceCount: kind === "voice" ? 1 : 0,
      dailyImageCount: kind === "image" ? 1 : 0,
      agentUsageCount: kind === "agent" ? 1 : 0,
      dailyResetDate:  today,
    }).where(eq(authSchema.user.id, userId))
  } else {
    const col = kindColumn(kind)
    await db.update(authSchema.user)
      .set({ [col]: sql`${authSchema.user[col as keyof typeof authSchema.user]} + 1` })
      .where(eq(authSchema.user.id, userId))
  }
}

function kindColumn(kind: AccessKind): string {
  switch (kind) {
    case "chat":  return "dailyChatCount"
    case "voice": return "dailyVoiceCount"
    case "image": return "dailyImageCount"
    case "agent": return "agentUsageCount"
  }
}
