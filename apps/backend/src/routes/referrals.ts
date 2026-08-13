import { Hono } from "hono"
import { authenticate } from "../auth.js"
import { getReferralStats, redeemReferralCode } from "../services/referrals.js"

export const referralsRouter = new Hono()

referralsRouter.use("*", authenticate)

referralsRouter.get("/me", async (c) => {
  const user = c.get("user")
  const stats = await getReferralStats(user.id)
  return c.json(stats)
})

type RedeemBody = { code?: string }

referralsRouter.post("/redeem", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as RedeemBody
  const code = body.code?.trim()
  if (!code) return c.json({ error: "code is required", code: "invalid_code" }, 400)
  if (!user.createdAt)
    return c.json(
      { error: "account creation time unavailable", code: "invalid_account_state" },
      400,
    )

  const result = await redeemReferralCode({
    code,
    referredUserId: user.id,
    referredUserCreatedAt: user.createdAt,
  })
  return c.json(result)
})
