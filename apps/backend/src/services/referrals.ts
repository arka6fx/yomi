import { randomBytes } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db, referralEvents } from "@yomi/db"
import * as authSchema from "../auth-schema.js"
import { grantCredits } from "./credit-ledger.js"

export const REFERRAL_CREDIT_AMOUNT = 100
export const REFERRAL_CAP = 20
const NEW_ACCOUNT_WINDOW_MS = 15 * 60 * 1000

function isDuplicateReferralCodeError(err: unknown): boolean {
  return String(err).includes("user_referral_code_unique")
}

function isDuplicateReferredUserError(err: unknown): boolean {
  return String(err).includes("referral_events_referred_user_id_unique")
}

export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const [existing] = await db
    .select({ referralCode: authSchema.user.referralCode })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  if (existing?.referralCode) return existing.referralCode

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomBytes(4).toString("hex")
    try {
      await db
        .update(authSchema.user)
        .set({ referralCode: code })
        .where(eq(authSchema.user.id, userId))
      return code
    } catch (err) {
      if (!isDuplicateReferralCodeError(err)) throw err
    }
  }
  throw new Error("failed to generate a unique referral code after 3 attempts")
}

export async function getReferralStats(userId: string) {
  const code = await getOrCreateReferralCode(userId)
  const events = await db
    .select({
      id: referralEvents.id,
      creditsGranted: referralEvents.creditsGranted,
      createdAt: referralEvents.createdAt,
    })
    .from(referralEvents)
    .where(eq(referralEvents.referrerUserId, userId))
    .orderBy(referralEvents.createdAt)
    .limit(100)

  return {
    code,
    count: events.length,
    cap: REFERRAL_CAP,
    creditsEarned: events.reduce((sum, e) => sum + e.creditsGranted, 0),
    events,
  }
}

export type RedeemReferralReason =
  | "not_new_account"
  | "invalid_code"
  | "self_referral"
  | "cap_reached"
  | "already_redeemed"
  | "insert_failed"

export async function redeemReferralCode(input: {
  code: string
  referredUserId: string
  referredUserCreatedAt: Date
}): Promise<{ redeemed: boolean; reason?: RedeemReferralReason }> {
  const logResult = (result: { redeemed: boolean; reason?: RedeemReferralReason }) => {
    console.log("[referral] redeem", {
      redeemed: result.redeemed,
      reason: result.reason,
      referredUserId: input.referredUserId,
    })
    return result
  }

  if (Date.now() - input.referredUserCreatedAt.getTime() > NEW_ACCOUNT_WINDOW_MS) {
    return logResult({ redeemed: false, reason: "not_new_account" })
  }

  const [referrer] = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.referralCode, input.code))
    .limit(1)
  if (!referrer) return logResult({ redeemed: false, reason: "invalid_code" })
  if (referrer.id === input.referredUserId)
    return logResult({ redeemed: false, reason: "self_referral" })

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralEvents)
    .where(eq(referralEvents.referrerUserId, referrer.id))
    .limit(1)
  if ((countRow?.count ?? 0) >= REFERRAL_CAP)
    return logResult({ redeemed: false, reason: "cap_reached" })

  let eventId: string
  try {
    const [row] = await db
      .insert(referralEvents)
      .values({
        referrerUserId: referrer.id,
        referredUserId: input.referredUserId,
        creditsGranted: REFERRAL_CREDIT_AMOUNT,
      })
      .returning({ id: referralEvents.id })
    if (!row) return logResult({ redeemed: false, reason: "insert_failed" })
    eventId = row.id
  } catch (err) {
    if (isDuplicateReferredUserError(err)) {
      // A prior attempt already inserted the referralEvents row (guaranteed unique by
      // referred_user_id), but grantCredits may never have completed for it — e.g. a
      // transient DB error between the insert and the grant call. Look up that row and
      // retry the grant with the same sourceId/idempotencyKey; grantCredits is idempotent
      // on idempotencyKey, so this is a safe no-op if the grant already landed.
      const [existing] = await db
        .select({ id: referralEvents.id })
        .from(referralEvents)
        .where(eq(referralEvents.referredUserId, input.referredUserId))
        .limit(1)
      if (existing) {
        await grantCredits({
          userId: referrer.id,
          amount: REFERRAL_CREDIT_AMOUNT,
          source: "referral",
          sourceId: `referral:${existing.id}`,
          idempotencyKey: `referral:${existing.id}:credit`,
          reason: "referral_bonus",
        })
      }
      return logResult({ redeemed: false, reason: "already_redeemed" })
    }
    throw err
  }

  await grantCredits({
    userId: referrer.id,
    amount: REFERRAL_CREDIT_AMOUNT,
    source: "referral",
    sourceId: `referral:${eventId}`,
    idempotencyKey: `referral:${eventId}:credit`,
    reason: "referral_bonus",
  })

  return logResult({ redeemed: true })
}
