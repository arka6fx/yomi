import { db } from "@yomi/db"
import { user } from "../apps/backend/src/auth-schema.js"
import { eq } from "drizzle-orm"

async function run() {
  const [userRecord] = await db.select().from(user).where(eq(user.email, "arkagarai292@gmail.com")).limit(1)
  console.log("=== Current User DB Record ===")
  console.log(JSON.stringify(userRecord, null, 2))

  console.log("\n=== Current User Credits ===")
  const userCredits = await db.query.creditAccounts?.findFirst({
    where: (t, { eq }) => eq(t.userId, userRecord!.id),
  })
  console.log(JSON.stringify(userCredits, null, 2))
}

run().catch(console.error).then(() => process.exit(0))
