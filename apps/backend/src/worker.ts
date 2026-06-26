import { app, startGateway } from "./index.js"
import { runDueSchedules } from "./services/schedule-runner.js"

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

interface ScheduledEvent {
  cron: string
  scheduledTime: number
}

let gatewayStarted = false

function propagateEnv(env: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value.replace(/^﻿/, "")
  }
}

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    try {
      propagateEnv(env)

      // Start gateway once — each request gets its own isolated waitUntil
      // so the promise is properly bound to the current request context.
      const url = new URL(request.url)
      if (!url.pathname.startsWith("/api/auth/") && !gatewayStarted) {
        gatewayStarted = true
        ctx.waitUntil(startGateway().catch((err) => {
          console.error("[gateway] start error:", err)
          gatewayStarted = false
        }))
      }

      return await app.fetch(request, env, ctx as never)
    } catch (err) {
      console.error("[worker] error:", err)
      return new Response(JSON.stringify({ error: "internal_server_error", message: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }
  },

  // Cron trigger (configured in wrangler.jsonc) — runs due cloud schedules.
  async scheduled(_event: ScheduledEvent, env: Record<string, unknown>, ctx: ExecutionContext) {
    propagateEnv(env)
    ctx.waitUntil(
      runDueSchedules()
        .then(({ ran }) => {
          if (ran > 0) console.warn(`[schedules] ran ${ran} due schedule(s)`)
        })
        .catch((err) => console.error("[schedules] sweep error:", err)),
    )
  },
}
