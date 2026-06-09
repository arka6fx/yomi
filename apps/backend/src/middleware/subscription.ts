import type { Context, Next } from "hono"
import {
  effectivePlanForUser,
  hasBillablePlanAccess,
  featureLimitForUser,
  isOwnerUser,
} from "../entitlements.js"

export type AccessKind = "chat" | "voice" | "agent"

export function requireAccess(kind: AccessKind) {
  return async (c: Context, next: Next) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "Unauthorized", code: "unauthorized" }, 401)

    // Owners always pass through
    if (isOwnerUser(user)) return next()

    const plan = effectivePlanForUser(user)

    // Pro/Max need an active subscription (or within past-due grace period)
    if (!hasBillablePlanAccess(user)) {
      const status = user.subscriptionStatus ?? "inactive"
      const msg = status === "past_due"
        ? "Your payment is past due. Update your payment method to restore full access."
        : "Your subscription needs attention before Yomi can process more requests."
      return c.json(
        {
          error: msg,
          code: "subscription_inactive",
          plan,
          subscriptionStatus: user.subscriptionStatus,
        },
        402,
      )
    }

    // Warn past-due users but let them through (grace period)
    if (user.subscriptionStatus === "past_due") {
      c.header("X-Yomi-Billing-Warning", "past_due")
    }

    // Kind-specific feature gating
    if (kind === "agent") {
      const limit = featureLimitForUser(user, "desktopAutomation")
      if (limit === 0) {
        return c.json(
          {
            error: "Desktop automation is not available on your plan.",
            code: "feature_not_available",
            plan,
          },
          403,
        )
      }
    }

    return next()
  }
}
