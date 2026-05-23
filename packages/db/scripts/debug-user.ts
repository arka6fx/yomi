import { sql } from "drizzle-orm"
import { db } from "../src/index.js"

const rows = await db.execute(sql.raw(`
  SELECT id, email, role, plan
  FROM "user"
  WHERE email = 'owner@example.com'
`))
console.table(rows.rows)

// Also check session user_id format
const sess = await db.execute(sql.raw(`
  SELECT s.token, s.user_id, u.id as user_id_in_user_table
  FROM session s
  JOIN "user" u ON u.id = s.user_id
  WHERE u.email = 'owner@example.com'
  LIMIT 2
`))
console.log("\nSessions:")
console.table(sess.rows)

process.exit(0)
