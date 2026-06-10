import type { Context, Next } from "hono"
import {
  effectivePlanForUser,
  hasBillablePlanAccess,
  featureLimitForUser,
  isOwnerUser,
  getPlanConfig,
} from "../entitlements.js"
import type { FeatureKey } from "@yomi/shared/plans"

export type AccessKind = "chat" | "voice" | "agent" | "screenshot" | "reasoning" | "desktop_automation" | "browser_automation" | "messaging"

const KIND_FEATURE_MAP: Record<AccessKind, FeatureKey | null> = {
  chat: "chat",
  voice: "voiceMinutes",
  agent: "desktopAutomation",
  screenshot: "screenshots",
  reasoning: "reasoning",
  desktop_automation: "desktopAutomation",
  browser_automation: "browserAutomation",
  messaging: "gatewayMessages",
}

export function requireAccess(kind: AccessKind) {
  return async (c: Context, next: Next) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "Unauthorized", code: "unauthorized" }, 401)

    if (isOwnerUser(user)) return next()

    const plan = effectivePlanForUser(user)

    if (!hasBillablePlanAccess(user)) {
      const status = user.subscriptionStatus ?? "inactive"
      const msg = status === "past_due"
        ? "Your payment is past due. Update your payment method to restore full access."
        : "Your subscription needs attention before Yomi can process more requests."
      return c.json(
        { error: msg, code: "subscription_inactive", plan, subscriptionStatus: user.subscriptionStatus },
        402,
      )
    }

    if (user.subscriptionStatus === "past_due") {
      c.header("X-Yomi-Billing-Warning", "past_due")
    }

    const featureKey = KIND_FEATURE_MAP[kind]
    if (featureKey) {
      const limit = featureLimitForUser(user, featureKey)
      if (limit === 0) {
        const planConfig = getPlanConfig(user)
        return c.json(
          {
            error: `${planConfig.name} does not include ${kind}. Upgrade to access this feature.`,
            code: "feature_not_available",
            plan,
            feature: featureKey,
            upgradeUrl: "/dashboard?upgrade=true",
          },
          403,
        )
      }
    }

    return next()
  }
}
