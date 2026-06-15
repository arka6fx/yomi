import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"

// SELECT-only guard — rejects anything that looks like a write statement
const WRITE_PATTERN = /^\s*(insert|update|delete|drop|truncate|alter|create|replace|merge|call|execute|exec|grant|revoke|set|begin|commit|rollback)\b/i

function assertReadOnly(sql: string): void {
  if (WRITE_PATTERN.test(sql)) {
    throw new Error("Only SELECT queries are allowed in read-only mode.")
  }
}

export function createPostgresTools(ctx: ConnectorContext): ToolSet {
  return {
    "postgres-query": tool({
      description:
        "Run a read-only SQL SELECT query against the connected PostgreSQL database. Maximum 50 rows returned.",
      parameters: z.object({
        sql: z.string().max(2000).describe("SQL SELECT query to execute"),
        params: z
          .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional()
          .describe("Positional parameters ($1, $2, ...) for parameterized queries"),
      }),
      execute: async ({ sql, params }) => {
        try {
          assertReadOnly(sql)

          const dsn = await ctx.getAccessToken(ctx.userId, "postgres")
          if (!dsn) return { error: "No DSN configured for this Postgres connection." }

          // Dynamic import so this module doesn't force a pg dep on non-postgres builds
          // @ts-expect-error — pg is an optional runtime dep
          const { Client } = await import("pg").catch(() => {
            throw new Error("pg package not installed — run: bun add pg")
          })

          const client = new Client({ connectionString: dsn })
          await client.connect()
          try {
            const result = await client.query(sql, params ?? [])
            const rows = result.rows.slice(0, 50)
            return {
              rowCount: rows.length,
              totalCount: result.rowCount ?? rows.length,
              columns: result.fields.map((f: { name: string }) => f.name),
              rows,
              truncated: (result.rowCount ?? 0) > 50,
            }
          } finally {
            await client.end()
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "postgres-listTables": tool({
      description: "List all user tables in the connected PostgreSQL database.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const dsn = await ctx.getAccessToken(ctx.userId, "postgres")
          if (!dsn) return { error: "No DSN configured." }

          // @ts-expect-error — pg is an optional runtime dep
          const { Client } = await import("pg").catch(() => {
            throw new Error("pg package not installed — run: bun add pg")
          })

          const client = new Client({ connectionString: dsn })
          await client.connect()
          try {
            const result = await client.query(
              `SELECT table_schema, table_name
               FROM information_schema.tables
               WHERE table_type = 'BASE TABLE'
                 AND table_schema NOT IN ('pg_catalog','information_schema')
               ORDER BY table_schema, table_name
               LIMIT 100`,
            )
            return { tables: result.rows }
          } finally {
            await client.end()
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
  }
}

export const postgresDef: ConnectorDef = {
  id: "postgres",
  name: "PostgreSQL",
  category: "data-analytics",
  icon: "postgres",
  description: "Run read-only SQL queries against a PostgreSQL database. Only SELECT statements allowed.",
  readOnlyByDefault: true,
  auth: {
    kind: "connection_string",
    field: {
      label: "PostgreSQL Connection String",
      placeholder: "postgresql://user:password@host:5432/dbname",
    },
    readOnly: true,
  },
  setup: {
    providerConsoleUrl: "",
    steps: [
      "Obtain a PostgreSQL connection string from your database provider (Neon, Supabase, Railway, etc.)",
      "Format: postgresql://user:password@host:5432/dbname",
      "For read-only access, create a role with SELECT privileges only",
    ],
    collect: [],
    docsUrl: "https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING",
  },
  tools: createPostgresTools,
}
