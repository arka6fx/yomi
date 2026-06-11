import { createHash } from "node:crypto"
import { db, processedPaymentEvents } from "@yomi/db"

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
