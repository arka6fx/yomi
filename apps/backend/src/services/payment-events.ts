import { createHash } from "node:crypto"
import { db, paymentRecords, processedPaymentEvents } from "@yomi/db"
import { and, eq } from "drizzle-orm"

export function payloadHash(payload: string): string {
  return createHash("sha256").update(payload).digest("hex")
}

export async function recordPaymentEvent(input: {
  provider: string
  eventId: string
  eventType: string
  payloadHash: string
}): Promise<{ duplicate: boolean }> {
  const inserted = await db
    .insert(processedPaymentEvents)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: processedPaymentEvents.id })

  return { duplicate: inserted.length === 0 }
}

export async function upsertPaymentRecord(input: {
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
  metadata?: Record<string, unknown>
}): Promise<string | null> {
  if (input.providerOrderId) {
    const [existing] = await db
      .select({ id: paymentRecords.id })
      .from(paymentRecords)
      .where(
        and(
          eq(paymentRecords.provider, input.provider),
          eq(paymentRecords.providerOrderId, input.providerOrderId),
        ),
      )
      .limit(1)

    if (existing) {
      await db
        .update(paymentRecords)
        .set({
          status: input.status,
          providerPaymentId: input.providerPaymentId ?? null,
          providerCustomerId: input.providerCustomerId ?? null,
          providerSubscriptionId: input.providerSubscriptionId ?? null,
          amountCents: input.amountCents,
          currency: input.currency,
          metadata: input.metadata ?? null,
          updatedAt: new Date(),
        })
        .where(eq(paymentRecords.id, existing.id))
      return existing.id
    }
  }

  // No existing record found by providerOrderId — insert fresh
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
