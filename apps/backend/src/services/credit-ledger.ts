import {
  creditAccounts,
  creditGrants,
  creditTransactions,
  db,
  paymentRecords,
  usageEvents,
} from "@yomi/db"
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"

type CreditMetadata = Record<string, unknown>

export type CreditGrantSource =
  | "subscription_cycle"
  | "credit_pack"
  | "admin_adjustment"
  | "refund"
  | "migration"
  | "promo"

export type CreditDebitType = "consume" | "refund" | "adjustment" | "expire"

export type CreditSummary = {
  balance: number
  lifetimeGranted: number
  lifetimeConsumed: number
  lifetimeRefunded: number
  expiringSoon: number
  expiringSoonAt: Date | null
}

async function ensureCreditAccount(userId: string): Promise<void> {
  await db
    .insert(creditAccounts)
    .values({ userId })
    .onConflictDoNothing()
}

async function transactionByKey(idempotencyKey: string) {
  const [existing] = await db
    .select({
      id: creditTransactions.id,
      balanceAfter: creditTransactions.balanceAfter,
      amount: creditTransactions.amount,
    })
    .from(creditTransactions)
    .where(eq(creditTransactions.idempotencyKey, idempotencyKey))
    .limit(1)

  return existing ?? null
}

export async function getCreditSummary(userId: string): Promise<CreditSummary> {
  await ensureCreditAccount(userId)

  const [account] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1)

  const now = new Date()
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [expiring] = await db
    .select({
      credits: sql<number>`coalesce(sum(${creditGrants.creditsRemaining}), 0)`,
      expiresAt: sql<Date | null>`min(${creditGrants.expiresAt})`,
    })
    .from(creditGrants)
    .where(
      and(
        eq(creditGrants.userId, userId),
        eq(creditGrants.status, "active"),
        gt(creditGrants.creditsRemaining, 0),
        gt(creditGrants.expiresAt, now),
        sql`${creditGrants.expiresAt} <= ${soon}`,
      ),
    )

  return {
    balance: account?.availableCredits ?? 0,
    lifetimeGranted: account?.lifetimeGranted ?? 0,
    lifetimeConsumed: account?.lifetimeConsumed ?? 0,
    lifetimeRefunded: account?.lifetimeRefunded ?? 0,
    expiringSoon: Number(expiring?.credits ?? 0),
    expiringSoonAt: expiring?.expiresAt ?? null,
  }
}

export async function recentCreditTransactions(userId: string, limit = 20) {
  return db
    .select({
      id: creditTransactions.id,
      type: creditTransactions.type,
      amount: creditTransactions.amount,
      balanceAfter: creditTransactions.balanceAfter,
      reason: creditTransactions.reason,
      usageEventId: creditTransactions.usageEventId,
      usageKind: usageEvents.kind,
      usageCreditsCharged: usageEvents.creditsCharged,
      usageCreatedAt: usageEvents.createdAt,
      createdAt: creditTransactions.createdAt,
    })
    .from(creditTransactions)
    .leftJoin(usageEvents, eq(usageEvents.id, creditTransactions.usageEventId))
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit)
}

export async function createPaymentRecord(input: {
  userId: string
  provider: string
  kind: "subscription" | "credit_pack"
  productKey: string
  providerCustomerId?: string | null
  providerOrderId?: string | null
  providerPaymentId?: string | null
  providerSubscriptionId?: string | null
  amountCents: number
  currency: string
  status: string
  metadata?: CreditMetadata
}): Promise<string | null> {
  const inserted = await db
    .insert(paymentRecords)
    .values({
      userId: input.userId,
      provider: input.provider,
      kind: input.kind,
      productKey: input.productKey,
      providerCustomerId: input.providerCustomerId ?? null,
      providerOrderId: input.providerOrderId ?? null,
      providerPaymentId: input.providerPaymentId ?? null,
      providerSubscriptionId: input.providerSubscriptionId ?? null,
      amountCents: input.amountCents,
      currency: input.currency,
      status: input.status,
      metadata: input.metadata ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: paymentRecords.id })

  return inserted[0]?.id ?? null
}

export async function grantCredits(input: {
  userId: string
  amount: number
  source: CreditGrantSource
  sourceId: string
  idempotencyKey: string
  paymentId?: string | null
  expiresAt?: Date | null
  reason?: string
  metadata?: CreditMetadata
}): Promise<{ granted: boolean; balance: number }> {
  if (input.amount <= 0) throw new Error("credit grant amount must be positive")

  const existing = await transactionByKey(input.idempotencyKey)
  if (existing) return { granted: false, balance: existing.balanceAfter }

  await ensureCreditAccount(input.userId)

  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ${creditAccounts} where ${creditAccounts.userId} = ${input.userId} for update`)

    const [grant] = await tx
      .insert(creditGrants)
      .values({
        userId: input.userId,
        paymentId: input.paymentId ?? null,
        source: input.source,
        sourceId: input.sourceId,
        creditsGranted: input.amount,
        creditsRemaining: input.amount,
        expiresAt: input.expiresAt ?? null,
        metadata: input.metadata ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: creditGrants.id })

    if (!grant) {
      const [account] = await tx
        .select({ availableCredits: creditAccounts.availableCredits })
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, input.userId))
        .limit(1)
      return { granted: false, balance: account?.availableCredits ?? 0 }
    }

    const [account] = await tx
      .update(creditAccounts)
      .set({
        availableCredits: sql`${creditAccounts.availableCredits} + ${input.amount}`,
        lifetimeGranted: sql`${creditAccounts.lifetimeGranted} + ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditAccounts.userId, input.userId))
      .returning({ availableCredits: creditAccounts.availableCredits })

    const balance = account?.availableCredits ?? input.amount

    await tx.insert(creditTransactions).values({
      userId: input.userId,
      grantId: grant.id,
      paymentId: input.paymentId ?? null,
      type: "grant",
      amount: input.amount,
      balanceAfter: balance,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? null,
      metadata: input.metadata ?? null,
    })

    return { granted: true, balance }
  })
}

async function debitCredits(input: {
  userId: string
  amount: number
  type: CreditDebitType
  idempotencyKey: string
  usageEventId?: string | null
  paymentId?: string | null
  reason?: string
  metadata?: CreditMetadata
}): Promise<{ ok: boolean; charged: number; balance: number; insufficient?: boolean }> {
  if (input.amount <= 0) throw new Error("credit debit amount must be positive")

  const existing = await transactionByKey(input.idempotencyKey)
  if (existing) return { ok: true, charged: Math.abs(existing.amount), balance: existing.balanceAfter }

  await ensureCreditAccount(input.userId)

  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ${creditAccounts} where ${creditAccounts.userId} = ${input.userId} for update`)

    const [account] = await tx
      .select({ availableCredits: creditAccounts.availableCredits })
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, input.userId))
      .limit(1)

    const balanceBefore = account?.availableCredits ?? 0
    if (balanceBefore < input.amount) {
      return { ok: false, charged: 0, balance: balanceBefore, insufficient: true }
    }

    const now = new Date()
    const grants = await tx
      .select({
        id: creditGrants.id,
        creditsRemaining: creditGrants.creditsRemaining,
      })
      .from(creditGrants)
      .where(
        and(
          eq(creditGrants.userId, input.userId),
          eq(creditGrants.status, "active"),
          gt(creditGrants.creditsRemaining, 0),
          or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, now)),
        ),
      )
      .orderBy(sql`${creditGrants.expiresAt} asc nulls last`, asc(creditGrants.createdAt))

    let remaining = input.amount
    const grantBreakdown: Array<{ grantId: string; amount: number }> = []

    for (const grant of grants) {
      if (remaining <= 0) break
      const debit = Math.min(remaining, grant.creditsRemaining)
      remaining -= debit
      grantBreakdown.push({ grantId: grant.id, amount: debit })

      const nextRemaining = grant.creditsRemaining - debit
      await tx
        .update(creditGrants)
        .set({
          creditsRemaining: nextRemaining,
          status: nextRemaining === 0 ? "depleted" : "active",
        })
        .where(eq(creditGrants.id, grant.id))
    }

    if (remaining > 0) {
      return { ok: false, charged: 0, balance: balanceBefore, insufficient: true }
    }

    const accountUpdate = {
      availableCredits: sql`${creditAccounts.availableCredits} - ${input.amount}`,
      updatedAt: new Date(),
      ...(input.type === "consume"
        ? { lifetimeConsumed: sql`${creditAccounts.lifetimeConsumed} + ${input.amount}` }
        : {}),
      ...(input.type === "refund"
        ? { lifetimeRefunded: sql`${creditAccounts.lifetimeRefunded} + ${input.amount}` }
        : {}),
    }

    const [updated] = await tx
      .update(creditAccounts)
      .set(accountUpdate)
      .where(eq(creditAccounts.userId, input.userId))
      .returning({ availableCredits: creditAccounts.availableCredits })

    const balance = updated?.availableCredits ?? balanceBefore - input.amount

    await tx.insert(creditTransactions).values({
      userId: input.userId,
      usageEventId: input.usageEventId ?? null,
      paymentId: input.paymentId ?? null,
      type: input.type,
      amount: -input.amount,
      balanceAfter: balance,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        grantBreakdown,
      },
    })

    return { ok: true, charged: input.amount, balance }
  })
}

export async function consumeCredits(input: {
  userId: string
  amount: number
  idempotencyKey: string
  usageEventId?: string | null
  reason?: string
  metadata?: CreditMetadata
}) {
  return debitCredits({ ...input, type: "consume" })
}

export async function refundCredits(input: {
  userId: string
  amount: number
  idempotencyKey: string
  paymentId?: string | null
  reason?: string
  metadata?: CreditMetadata
}) {
  return debitCredits({ ...input, type: "refund" })
}

export async function expireUserCredits(
  userId: string,
  options?: { sources?: string[]; reason?: string },
): Promise<number> {
  const expired = await db
    .select({
      id: creditGrants.id,
      creditsRemaining: creditGrants.creditsRemaining,
    })
    .from(creditGrants)
    .where(
      and(
        eq(creditGrants.userId, userId),
        eq(creditGrants.status, "active"),
        gt(creditGrants.creditsRemaining, 0),
        options?.sources ? inArray(creditGrants.source, options.sources) : sql`1=1`,
      ),
    )

  let totalExpired = 0
  for (const grant of expired) {
    const result = await debitCredits({
      userId,
      amount: grant.creditsRemaining,
      type: "expire",
      idempotencyKey: `expire:upgrade:${grant.id}`,
      reason: options?.reason ?? "credits expired on plan upgrade",
      metadata: { grantId: grant.id },
    })
    if (result.ok) {
      totalExpired += result.charged
      await db.update(creditGrants).set({ status: "expired", creditsRemaining: 0 }).where(eq(creditGrants.id, grant.id))
    }
  }

  return totalExpired
}

export async function expireCredits(now = new Date()): Promise<number> {
  const expired = await db
    .select({
      id: creditGrants.id,
      userId: creditGrants.userId,
      creditsRemaining: creditGrants.creditsRemaining,
    })
    .from(creditGrants)
    .where(
      and(
        eq(creditGrants.status, "active"),
        gt(creditGrants.creditsRemaining, 0),
        sql`${creditGrants.expiresAt} is not null`,
        sql`${creditGrants.expiresAt} <= ${now}`,
      ),
    )

  let totalExpired = 0
  for (const grant of expired) {
    const result = await debitCredits({
      userId: grant.userId,
      amount: grant.creditsRemaining,
      type: "expire",
      idempotencyKey: `expire:${grant.id}`,
      reason: "credits expired",
      metadata: { grantId: grant.id },
    })
    if (result.ok) {
      totalExpired += result.charged
      await db.update(creditGrants).set({ status: "expired", creditsRemaining: 0 }).where(eq(creditGrants.id, grant.id))
    }
  }

  return totalExpired
}
