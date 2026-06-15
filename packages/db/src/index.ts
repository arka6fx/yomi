import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema.js"

type Db = ReturnType<typeof drizzle>

let dbInstance: Db | null = null

function getDatabaseUrl() {
  const url = typeof process !== "undefined" ? process.env["DATABASE_URL"] : undefined
  if (!url) {
    throw new Error("No database connection string was provided to neon()")
  }
  return url
}

function getDb() {
  if (dbInstance) return dbInstance
  const sql = neon(getDatabaseUrl())
  dbInstance = drizzle(sql, { schema })
  return dbInstance
}

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb() as object, prop, receiver)
    return typeof value === "function" ? value.bind(getDb()) : value
  },
}) as Db

export * from "./schema.js"
