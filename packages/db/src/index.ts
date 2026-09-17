import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema.js"
import journal from "../drizzle/meta/_journal.json" with { type: "json" }

type Db = ReturnType<typeof drizzle>

let dbInstance: Db | null = null

function getDatabaseUrl() {
  const url = typeof process !== "undefined" ? process.env["DATABASE_URL"] : undefined
  if (!url) {
    throw new Error("No database connection string was provided")
  }
  return url
}

// The Neon HTTP driver is stateless — every query is its own fetch, so nothing
// is held across requests. That is what makes it safe on Workers, where a
// pooled TCP connection created for one request cannot be reused by the next
// ("Cannot perform I/O on behalf of a different request"). Interactive
// transactions are the one thing it can't do; use `db.batch([...])` instead,
// which Neon runs as a single sequential transaction.
function getDb() {
  if (dbInstance) return dbInstance
  dbInstance = drizzle(neon(getDatabaseUrl()), { schema })
  return dbInstance
}

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb() as object, prop, receiver)
    return typeof value === "function" ? value.bind(getDb()) : value
  },
}) as Db

export * from "./schema.js"

// Snapshot of the migration journal at build time. Deploys ship code
// automatically but migrations are applied manually, so runtime health checks
// compare this against drizzle.__drizzle_migrations to detect schema drift —
// the failure mode that has repeatedly broken production.
// Drizzle's migrator applies an entry only when its `when` exceeds the max
// recorded created_at, so drift must be detected by timestamp, not row count —
// historical journal renumbering left some entries non-monotonic and skipped.
export const EXPECTED_MIGRATIONS = {
  count: journal.entries.length,
  latestWhen: journal.entries.reduce((max, e) => Math.max(max, e.when), 0),
  latestTag: journal.entries[journal.entries.length - 1]?.tag ?? null,
}
