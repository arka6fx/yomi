import { Hono } from "hono"
import { gte } from "drizzle-orm"
import { db, usageEvents, creditAccounts } from "@yomi/db"
import { user } from "../auth-schema.js"
import { authenticate } from "../auth.js"
import { isOwnerUser } from "../entitlements.js"
import { grantCredits } from "../services/credit-ledger.js"
import { getPlan } from "@yomi/shared/plans"

export const adminRouter = new Hono()

function currentMonthStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

// POST /api/admin/reset-all-usage
// Owner-only. Deletes all current-month usage events for every user and
// tops each user's credit balance back up to their plan's monthly allowance.
adminRouter.post("/reset-all-usage", authenticate, async (c) => {
  const caller = c.get("user")
  if (!isOwnerUser(caller)) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const monthStart = currentMonthStart()
  const monthKey = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`

  // 1. Wipe every usage event recorded this month for all users
  await db.delete(usageEvents).where(gte(usageEvents.createdAt, monthStart))

  // 2. Load all users + their current credit balances
  const allUsers = await db.select({ id: user.id, plan: user.plan, role: user.role, email: user.email }).from(user)
  const accounts = await db.select({ userId: creditAccounts.userId, balance: creditAccounts.availableCredits }).from(creditAccounts)
  const balanceByUser = new Map(accounts.map((a) => [a.userId, a.balance]))

  // 3. Top up each non-owner user's credits to their plan's monthly included amount
  let usersRestored = 0
  for (const u of allUsers) {
    if (isOwnerUser(u)) continue
    const plan = getPlan(u.plan ?? "explore")
    const balance = balanceByUser.get(u.id) ?? 0
    const deficit = plan.includedCredits - balance
    if (deficit <= 0) continue

    await grantCredits({
      userId: u.id,
      amount: deficit,
      source: "admin_adjustment",
      sourceId: `admin:reset:${monthKey}:${u.id}`,
      idempotencyKey: `admin:reset:${monthKey}:${u.id}`,
      reason: "Monthly usage reset by admin",
    })
    usersRestored++
  }

  return c.json({ ok: true, monthKey, usersTotal: allUsers.length, usersRestored })
})
