// Fetch a valid session token for the owner account
import { sql } from "drizzle-orm"
import { db } from "../src/index.js"

const rows = await db.execute(sql.raw(`
  SELECT s.token, s.expires_at, u.email, u.role, u.plan
  FROM session s
  JOIN "user" u ON u.id = s.user_id
  WHERE u.email = 'owner@example.com'
    AND s.expires_at > NOW()
  ORDER BY s.created_at DESC
  LIMIT 3
`))

if (rows.rows.length === 0) {
  console.log("No active sessions found — sign in at http://localhost:3000/signin first")
} else {
  console.log("Active sessions:")
  for (const row of rows.rows) {
    console.log(`  token: ${row.token}`)
    console.log(`  expires: ${row.expiresAt}`)
    console.log(`  role/plan: ${row.role} / ${row.plan}`)
    console.log()
  }
}
process.exit(0)
