import { db, creditAccounts } from "@yomi/db"
import { user } from "./auth-schema.js"
import { eq } from "drizzle-orm"

async function run() {
  const email = process.env["USER_EMAIL"]?.trim()
  if (!email) {
    console.error("Usage: USER_EMAIL=<email> bun run --env-file .env src/show-user-status.ts")
    process.exit(1)
  }
  const [userRecord] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  console.log("=== Current User DB Record ===")
  console.log(JSON.stringify(userRecord, null, 2))

  console.log("\n=== Current User Credits ===")
  const [userCredits] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userRecord!.id))
  console.log(JSON.stringify(userCredits ?? null, null, 2))
}

run()
  .catch(console.error)
  .then(() => process.exit(0))
