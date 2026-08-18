import { Hono } from "hono"
// PII redaction — must be first so it wraps console before any other module logs
import "./services/privacy/logging.js"
import { getAuth } from "./auth.js"
import { errorHandler } from "./middleware/error-handler.js"
import { llmRouter } from "./routes/llm.js"
import { usageRouter } from "./routes/usage.js"
import { billingRouter } from "./routes/billing.js"
import { profileRouter } from "./routes/profile.js"
import { ragRouter } from "./routes/rag.js"
import { ragDriveRouter } from "./routes/rag-drive.js"
import { memoryRouter } from "./routes/memory.js"
import { schedulesRouter } from "./routes/schedules.js"
import { referralsRouter } from "./routes/referrals.js"
import { streaksRouter } from "./routes/streaks.js"
import { suggestionsRouter } from "./routes/suggestions.js"
import { actionsRouter } from "./routes/actions.js"
import { proxyRouter } from "./routes/proxy.js"
import { gatewayRouter } from "./gateway/routes.js"
import { integrationsRouter } from "./routes/integrations.js"
import { customMcpRouter } from "./routes/custom-mcp.js"
import { conversationRouter } from "./routes/conversation.js"
import { statusRouter } from "./routes/status.js"
import { privacyRouter } from "./routes/privacy.js"
import { mcpRouter } from "./routes/mcp.js"
import "./connectors/defs/index.js" // registers all ConnectorDefs at startup
import { getDefaultGateway } from "./gateway/gateway-runner.js"
import { sql } from "drizzle-orm"
import { db, EXPECTED_MIGRATIONS } from "@yomi/db"
import { decodeAssetKey, fetchAsset } from "./services/asset-storage.js"
import { getAvatarKey } from "./services/streaks.js"

const app = new Hono()

app.onError(errorHandler)

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin")
  const webOrigin =
    process.env["CORS_ORIGIN"] ?? process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000"
  const allowedOrigins = new Set([webOrigin].filter(Boolean))
  const allowed = !!origin && allowedOrigins.has(origin)

  // Preflight: answer directly with the CORS headers.
  if (allowed && c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS",
        "Access-Control-Allow-Headers":
          c.req.header("Access-Control-Request-Headers") ?? "Authorization,Content-Type",
        Vary: "Origin",
      },
    })
  }

  await next()

  // Set headers on the final response — handlers that return a fresh Response
  // (e.g. Better Auth) drop headers stashed via c.header() before next().
  if (allowed) {
    c.res.headers.set("Access-Control-Allow-Origin", origin)
    c.res.headers.set("Access-Control-Allow-Credentials", "true")
    c.res.headers.set("Vary", "Origin")
  }
})

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }))

// Pure API host, nothing here is a page — keep it out of search entirely. getyomi.in's
// GSC property is domain-level so it covers this subdomain too and was flagging api root
// as a 404 "page that isn't indexed", even though a 404 already achieves that outcome.
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"))

// Deploys ship code automatically but migrations run manually, so the two can
// drift — the recurring cause of production 42703 errors. This endpoint makes
// drift observable: curl it after every deploy and alert on non-200.
app.get("/health/db", async (c) => {
  try {
    // Mirror drizzle's migrator: it applies an entry only when its journal
    // `when` exceeds the max recorded created_at, so drift is a timestamp
    // comparison — row count diverges permanently from journal length
    // (historical renumbering left some entries non-monotonic, never recorded).
    const result = (await db.execute(
      sql`select coalesce(max(created_at), 0)::bigint as latest, count(*)::int as count from drizzle.__drizzle_migrations`,
    )) as unknown as
      | { rows?: { latest: string; count: number }[] }
      | { latest: string; count: number }[]
    const row = Array.isArray(result) ? result[0] : result.rows?.[0]
    const latestApplied = Number(row?.latest ?? 0)
    const applied = Number(row?.count ?? 0)
    const body = {
      applied,
      latestApplied,
      latestExpected: EXPECTED_MIGRATIONS.latestWhen,
      latestTag: EXPECTED_MIGRATIONS.latestTag,
    }
    if (latestApplied < EXPECTED_MIGRATIONS.latestWhen) {
      console.error(
        `[health/db] schema drift: latest applied ${latestApplied} < expected ${EXPECTED_MIGRATIONS.latestWhen} (${EXPECTED_MIGRATIONS.latestTag})`,
      )
      return c.json({ status: "behind", ...body }, 503)
    }
    return c.json({ status: "ok", ...body })
  } catch (err) {
    console.error("[health/db] check failed:", err instanceof Error ? err.message : err)
    return c.json({ status: "error", error: "db check failed" }, 503)
  }
})

app.get("/api/assets/:encodedKey", async (c) => {
  try {
    const key = decodeAssetKey(c.req.param("encodedKey"))
    const asset = await fetchAsset(key)
    if (!asset) return c.notFound()
    return new Response(asset.bytes, {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (err) {
    console.error("[assets] fetch failed:", err instanceof Error ? err.message : err)
    return c.notFound()
  }
})

app.get("/api/user/avatar/:userId", async (c) => {
  try {
    const key = await getAvatarKey(c.req.param("userId"))
    if (!key) return c.notFound()
    const asset = await fetchAsset(key)
    if (!asset) return c.notFound()
    return new Response(asset.bytes, {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (err) {
    console.error("[avatar] fetch failed:", err instanceof Error ? err.message : err)
    return c.notFound()
  }
})

// OAuth callback: Better Auth handles directly. redirectURI is set to the API
// domain per-provider, and crossSubDomainCookies shares the session with landing.
app.on(["GET"], "/api/auth/callback/:provider", async (c) => {
  return getAuth().handler(c.req.raw)
})

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  return getAuth().handler(c.req.raw)
})

app.route("/api/llm", llmRouter)
app.route("/api/usage", usageRouter)
app.route("/api/billing", billingRouter)
app.route("/api/user", profileRouter)
app.route("/api/rag", ragRouter)
app.route("/api/rag/drive", ragDriveRouter)
app.route("/api/memory", memoryRouter)
app.route("/api/schedules", schedulesRouter)
app.route("/api/referrals", referralsRouter)
app.route("/api/streaks", streaksRouter)
app.route("/api/suggestions", suggestionsRouter)
app.route("/api/actions", actionsRouter)
app.route("/api/v1", proxyRouter)
app.route("/api/gateway", gatewayRouter)
app.route("/api/integrations", integrationsRouter)
app.route("/api/custom-mcp", customMcpRouter)
app.route("/api/conversation", conversationRouter)
app.route("/api/status", statusRouter)
app.route("/api/privacy", privacyRouter)
app.route("/api/mcp", mcpRouter)

export function startGateway(): Promise<void> {
  const gateway = getDefaultGateway()
  return gateway.start(process.env["YOMI_PLAN"]).catch((err) => {
    console.error("[gateway] failed to start:", err)
  })
}

const PORT = Number(process.env["PORT"] ?? 3001)

// In-process replacement for the Workers cron trigger (see worker.ts scheduled()).
// Only runs in the standalone Bun server (EC2/Docker); the Worker path never
// enters this block since typeof Bun === "undefined" there.
async function runCronSweeps(): Promise<void> {
  const { runDueSchedules } = await import("./services/schedule-runner.js")
  const { runDueConnectorNudges } = await import("./services/connector-nudge.js")
  const { runPrivacyRetention } = await import("./services/privacy/retention.js")
  const { runDriveSyncSweep } = await import("./services/rag/drive-sync.js")
  const { summarizeUnsummarizedSessions } = await import("./services/agent-sessions.js")
  const { renewExploreCredits } = await import("./services/explore-renewal.js")
  const { renewNonBilledPaidCredits } = await import("./services/plan-renewal.js")
  const { sweepMemoryConsolidation } = await import("./services/memory/consolidation.js")
  await Promise.all([
    runDueSchedules()
      .then(({ ran }) => {
        if (ran > 0) console.warn(`[schedules] ran ${ran} due schedule(s)`)
      })
      .catch((err) => console.error("[schedules] sweep error:", err)),
    runDueConnectorNudges()
      .then(({ ran }) => {
        if (ran > 0) console.warn(`[connector-nudge] ran ${ran} due nudge(s)`)
      })
      .catch((err) => console.error("[connector-nudge] sweep error:", err)),
    runPrivacyRetention()
      .then((r) => {
        const domainTotal = Object.values(r.domains).reduce((sum, n) => sum + n, 0)
        const total =
          r.expiredExports + r.oldDeletionJobs + r.hardDeletedUsers + r.oldAuditEvents + domainTotal
        if (total > 0) console.warn(`[retention] cleaned ${total} items`)
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
    renewExploreCredits()
      .then(({ renewed }) => {
        if (renewed > 0) console.warn(`[explore-renewal] renewed ${renewed} account(s)`)
      })
      .catch((err) => console.error("[explore-renewal] sweep error:", err)),
    renewNonBilledPaidCredits()
      .then(({ renewed }) => {
        if (renewed > 0) console.warn(`[plan-renewal] renewed ${renewed} non-billed account(s)`)
      })
      .catch((err) => console.error("[plan-renewal] sweep error:", err)),
    new Date().getMinutes() === 0
      ? sweepMemoryConsolidation()
          .then((count) => {
            if (count > 0) console.warn(`[memory-consolidation] merged ${count} pair(s)`)
          })
          .catch((err) => console.error("[memory-consolidation] sweep error:", err))
      : Promise.resolve(),
  ])
}

if (typeof Bun !== "undefined") {
  const server = Bun.serve({
    port: PORT,
    fetch: app.fetch,
  })

  console.warn(`Backend listening on :${server.port}`)
  startGateway().catch((err) => console.error("[gateway] startup error:", err))

  // Fire every minute, matching the wrangler cron ("* * * * *"). A run is skipped
  // if the previous one is still in flight to avoid overlap.
  let cronRunning = false
  setInterval(() => {
    if (cronRunning) return
    cronRunning = true
    runCronSweeps().finally(() => {
      cronRunning = false
    })
  }, 60_000)
}

export { app }
