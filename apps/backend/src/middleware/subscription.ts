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

    // Pro/Max need an active subscription
    if (!hasBillablePlanAccess(user)) {
      return c.json(
        {
          error: "Your subscription needs attention before Yomi can process more requests.",
          code: "subscription_inactive",
          plan,
        },
        402,
      )
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
