import type { Context, Next } from "hono"
import { type PrivacyConsentPurpose } from "@yomi/shared/privacy"
import { checkConsent } from "../services/privacy/checks.js"

export function requireConsent(purpose: PrivacyConsentPurpose) {
  return async (c: Context, next: Next) => {
    const user = c.get("user")
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401)
    }
    const result = await checkConsent(user.id, purpose)
    if (!result.allowed) {
      return c.json({ error: `Consent required: ${result.reason}` }, 403)
    }
    await next()
  }
}
