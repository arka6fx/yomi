import { app, startGateway } from "./index.js"
import { runDueSchedules } from "./services/schedule-runner.js"
import { runPrivacyRetention } from "./services/privacy/retention.js"
import { runDriveSyncSweep } from "./services/rag/drive-sync.js"
import { summarizeUnsummarizedSessions } from "./services/agent-sessions.js"

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
    if (typeof value === "string") process.env[key] = value.replace(/^\uFEFF/, "")
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
        ctx.waitUntil(
          startGateway().catch((err) => {
            console.error("[gateway] start error:", err)
            gatewayStarted = false
          }),
        )
      }

      return await app.fetch(request, env, ctx as never)
    } catch (err) {
      console.error("[worker] error:", err)
      return new Response(
        JSON.stringify({ error: "internal_server_error", message: String(err) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      )
    }
  },

  // Cron trigger (configured in wrangler.jsonc) — runs due cloud schedules.
  async scheduled(_event: ScheduledEvent, env: Record<string, unknown>, ctx: ExecutionContext) {
    propagateEnv(env)
    ctx.waitUntil(
      Promise.all([
        runDueSchedules()
          .then(({ ran }) => {
            if (ran > 0) console.warn(`[schedules] ran ${ran} due schedule(s)`)
          })
          .catch((err) => console.error("[schedules] sweep error:", err)),
        runPrivacyRetention()
          .then((r) => {
            const domainTotal = Object.values(r.domains).reduce((sum, n) => sum + n, 0)
            const total =
              r.expiredExports +
              r.oldDeletionJobs +
              r.hardDeletedUsers +
              r.oldAuditEvents +
              domainTotal
            if (total > 0)
              console.warn(
                `[retention] cleaned ${total} items (exports:${r.expiredExports} jobs:${r.oldDeletionJobs} users:${r.hardDeletedUsers} audit:${r.oldAuditEvents} convo:${r.domains.conversations} raglogs:${r.domains.rag_retrieval_logs} usage:${r.domains.usage_events} pending:${r.domains.pending_actions} devices:${r.domains.devices} codes:${r.domains.expired_codes})`,
              )
          })
          .catch((err) => console.error("[retention] sweep error:", err)),
        runDriveSyncSweep()
          .then(({ ran }) => {
            if (ran > 0) console.warn(`[drive-sync] swept ${ran} source(s)`)
          })
          .catch((err) => console.error("[drive-sync] sweep error:", err)),
        summarizeUnsummarizedSessions()
          .then((count) => {
            if (count > 0) console.warn(`[session-summary] summarized ${count} session(s)`)
          })
          .catch((err) => console.error("[session-summary] sweep error:", err)),
      ]),
    )
  },
}
