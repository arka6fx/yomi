import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"

const WRITE_PATTERN = /^\s*(insert|update|delete|drop|truncate|alter|create|replace|merge|call|execute|exec|grant|revoke|set\s+(?!names|character)|begin|commit|rollback)\b/i

function assertReadOnly(sql: string): void {
  if (WRITE_PATTERN.test(sql)) {
    throw new Error("Only SELECT queries are allowed in read-only mode.")
  }
}

export function createMysqlTools(ctx: ConnectorContext): ToolSet {
  return {
    "mysql.query": tool({
      description:
        "Run a read-only SQL SELECT query against the connected MySQL database. Maximum 50 rows returned.",
      parameters: z.object({
        sql: z.string().max(2000).describe("SQL SELECT query to execute"),
        params: z
          .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional()
          .describe("Positional ? parameters for parameterized queries"),
      }),
      execute: async ({ sql, params }) => {
        try {
          assertReadOnly(sql)

          const dsn = await ctx.getAccessToken(ctx.userId, "mysql")
          if (!dsn) return { error: "No DSN configured for this MySQL connection." }

          // @ts-ignore — mysql2 is an optional runtime dep
          const mysql2 = await import("mysql2/promise").catch(() => {
            throw new Error("mysql2 package not installed — run: bun add mysql2")
          })

          const conn = await mysql2.createConnection(dsn)
          try {
            const [rows, fields] = await conn.execute(sql, params ?? [])
            const rowArray = Array.isArray(rows) ? rows.slice(0, 50) : []
            const fieldNames = Array.isArray(fields)
              ? (fields as { name: string }[]).map((f) => f.name)
              : []
            return {
              rowCount: rowArray.length,
              columns: fieldNames,
              rows: rowArray,
              truncated: rowArray.length === 50,
            }
          } finally {
            await conn.end()
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "mysql.listTables": tool({
      description: "List all user tables in the connected MySQL database.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const dsn = await ctx.getAccessToken(ctx.userId, "mysql")
          if (!dsn) return { error: "No DSN configured." }

          // @ts-ignore — mysql2 is an optional runtime dep
          const mysql2 = await import("mysql2/promise").catch(() => {
            throw new Error("mysql2 package not installed — run: bun add mysql2")
          })

          const conn = await mysql2.createConnection(dsn)
          try {
            const [rows] = await conn.execute(
              `SELECT TABLE_SCHEMA, TABLE_NAME
               FROM information_schema.TABLES
               WHERE TABLE_TYPE = 'BASE TABLE'
                 AND TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys')
               ORDER BY TABLE_SCHEMA, TABLE_NAME
               LIMIT 100`,
            )
            return { tables: rows }
          } finally {
            await conn.end()
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
  }
}

export const mysqlDef: ConnectorDef = {
  id: "mysql",
  name: "MySQL",
  category: "data-analytics",
  icon: "mysql",
  description: "Run read-only SQL queries against a MySQL database. Only SELECT statements allowed.",
  readOnlyByDefault: true,
  auth: {
    kind: "connection_string",
    field: {
      label: "MySQL Connection String",
      placeholder: "mysql://user:password@host:3306/dbname",
    },
    readOnly: true,
  },
  setup: {
    providerConsoleUrl: "",
    steps: [
      "Obtain a MySQL connection string from your database host",
      "Format: mysql://user:password@host:3306/dbname",
      "For read-only access, create a user with SELECT privileges only",
    ],
    collect: [],
    docsUrl: "https://www.npmjs.com/package/mysql2#connection-options",
  },
  tools: createMysqlTools,
}
