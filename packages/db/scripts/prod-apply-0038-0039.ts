import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { Pool } from "pg"

type Journal = {
  entries: { tag: string; when: number }[]
}

const reportPath = process.env["PROD_MIGRATION_REPORT"] ?? "/tmp/prod-migration-report.md"
const migrationTags = new Set(["0038_streaks_leaderboard", "0039_leaderboard_handle_unique"])
const migrationsDir = process.env["MIGRATIONS_DIR"] ?? `${process.cwd()}/drizzle`
const journal = JSON.parse(
  readFileSync(`${migrationsDir}/meta/_journal.json`, "utf8"),
) as Journal
const entries = journal.entries.filter((entry) => migrationTags.has(entry.tag))
const report: string[] = [
  "# Prod migration report",
  "",
  `Started: ${new Date().toISOString()}`,
  "",
]

function add(line = "") {
  report.push(line)
}

function writeReport() {
  writeFileSync(reportPath, `${report.join("\n")}\n`)
}

const databaseUrl = process.env["DATABASE_URL"]
if (!databaseUrl) {
  add("Status: failed")
  add("Error: DATABASE_URL is not set")
  writeReport()
  process.exit(1)
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    ca: readFileSync(process.env["RDS_CA_BUNDLE"] ?? `${process.cwd()}/certs/rds-global-bundle.pem`),
  },
})

try {
  const client = await pool.connect()
  try {
    const before = await client.query(
      'select coalesce(max(created_at), 0)::bigint as latest, count(*)::int as count from drizzle.__drizzle_migrations',
    )
    add(`Before latest: ${before.rows[0]?.latest ?? "unknown"}`)
    add(`Before count: ${before.rows[0]?.count ?? "unknown"}`)
    add("")

    await client.query("begin")
    for (const entry of entries) {
      const sql = readFileSync(`${migrationsDir}/${entry.tag}.sql`, "utf8")
      const existing = await client.query(
        "select 1 from drizzle.__drizzle_migrations where created_at = $1 limit 1",
        [entry.when],
      )
      if (existing.rowCount === 0) {
        for (const statement of sql.split("--> statement-breakpoint")) {
          const trimmed = statement.trim()
          if (trimmed) {
            await client.query(trimmed)
          }
        }
        await client.query(
          `insert into drizzle.__drizzle_migrations ("hash", "created_at")
           select $1, $2
           where not exists (
             select 1 from drizzle.__drizzle_migrations where created_at = $2
           )`,
          [createHash("sha256").update(sql).digest("hex"), entry.when],
        )
        add(`Applied: ${entry.tag}`)
      } else {
        add(`Already recorded: ${entry.tag}`)
      }
    }
    await client.query("commit")

    const after = await client.query(
      'select coalesce(max(created_at), 0)::bigint as latest, count(*)::int as count from drizzle.__drizzle_migrations',
    )
    const columns = await client.query(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'user'
         and column_name in (
           'current_streak',
           'longest_streak',
           'last_active_date',
           'total_messages_sent',
           'leaderboard_opt_in',
           'leaderboard_handle'
         )
       order by column_name`,
    )
    const indexes = await client.query(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and tablename = 'user'
         and indexname = 'user_leaderboard_handle_unique'`,
    )

    add("")
    add(`After latest: ${after.rows[0]?.latest ?? "unknown"}`)
    add(`After count: ${after.rows[0]?.count ?? "unknown"}`)
    add(`Columns: ${columns.rows.map((row) => row.column_name).join(", ")}`)
    add(`Index present: ${indexes.rowCount === 1}`)
    add("Status: ok")
  } catch (err) {
    await client.query("rollback").catch(() => undefined)
    add("")
    add("Status: failed")
    add(`Error: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  } finally {
    client.release()
  }
} finally {
  await pool.end()
  add(`Finished: ${new Date().toISOString()}`)
  writeReport()
}
