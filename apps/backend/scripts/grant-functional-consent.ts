// Grants the functional consent subset (chat/memory/connectors/telegram) on an
// existing account — mirrors the signup hook for users created before it shipped.
//
//   bun apps/backend/scripts/grant-functional-consent.ts <email>

import { db } from "@yomi/db"
import { eq } from "drizzle-orm"
import { user } from "../src/auth-schema.js"
import { recordConsentDecision, getConsentSnapshot } from "../src/services/privacy/consent.js"

const email = process.argv[2]
if (!email) {
  console.error("usage: bun scripts/grant-functional-consent.ts <email>")
  process.exit(1)
}

const [account] = await db.select().from(user).where(eq(user.email, email)).limit(1)
if (!account) {
  console.error(`no user row for ${email} — sign in to Yomi with that account once, then re-run`)
  process.exit(1)
}

await recordConsentDecision({
  userId: account.id,
  purposes: ["conversation_history", "memory", "connector_data", "telegram_processing"],
  status: "granted",
  context: { appVersion: null, ipAddress: null, userAgent: null, metadata: { source: "manual_grant" } },
})

const snapshot = await getConsentSnapshot(account.id)
console.log(`${email} (${account.id}) consent snapshot:`)
for (const c of snapshot) console.log(`  ${c.purpose}: ${c.status}`)
