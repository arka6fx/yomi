import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import * as schema from "./schema.js"
import journal from "../drizzle/meta/_journal.json" with { type: "json" }

type Db = ReturnType<typeof drizzle>

let dbInstance: Db | null = null
let pool: Pool | null = null

function getDatabaseUrl() {
  const url = typeof process !== "undefined" ? process.env["DATABASE_URL"] : undefined
  if (!url) {
    throw new Error("No database connection string was provided")
  }
  return url
}

// RDS presents an AWS-issued cert; verify it against AWS's own CA bundle
// rather than disabling verification, since app<->DB traffic carries auth tokens.
const rdsCaBundle = readFileSync(
  fileURLToPath(new URL("../certs/rds-global-bundle.pem", import.meta.url)),
)

function getDb() {
  if (dbInstance) return dbInstance
  pool = new Pool({
    connectionString: getDatabaseUrl(),
    ssl: { ca: rdsCaBundle },
  })
  dbInstance = drizzle(pool, { schema })
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
