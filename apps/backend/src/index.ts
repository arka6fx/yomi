import { Hono } from "hono"
// PII redaction — must be first so it wraps console before any other module logs
import "./services/privacy/logging.js"
import { getAuth } from "./auth.js"
import { errorHandler } from "./middleware/error-handler.js"
import { llmRouter } from "./routes/llm.js"
import { sttRouter } from "./routes/stt.js"
import { ttsRouter } from "./routes/tts.js"
import { usageRouter } from "./routes/usage.js"
import { billingRouter } from "./routes/billing.js"
import { authRoutesRouter } from "./routes/auth-routes.js"
import { profileRouter } from "./routes/profile.js"
import { ragRouter } from "./routes/rag.js"
import { ragDriveRouter } from "./routes/rag-drive.js"
import { memoryRouter } from "./routes/memory.js"
import { schedulesRouter } from "./routes/schedules.js"
import { suggestionsRouter } from "./routes/suggestions.js"
import { actionsRouter } from "./routes/actions.js"
import { proxyRouter } from "./routes/proxy.js"
import { gatewayRouter } from "./gateway/routes.js"
import { integrationsRouter } from "./routes/integrations.js"
import { adminRouter } from "./routes/admin.js"
import { conversationRouter } from "./routes/conversation.js"
import { statusRouter } from "./routes/status.js"
import { privacyRouter } from "./routes/privacy.js"
import "./connectors/defs/index.js" // registers all ConnectorDefs at startup
import { getDefaultGateway } from "./gateway/gateway-runner.js"
import type { SidecarResolver } from "./gateway/gateway-runner.js"
import { eq, and, sql } from "drizzle-orm"
import { db, platformConnections, devices, EXPECTED_MIGRATIONS } from "@yomi/db"

const app = new Hono()

app.onError(errorHandler)

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin")
  const webOrigin =
    process.env["CORS_ORIGIN"] ?? process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000"
  const allowedOrigins = new Set([webOrigin].filter(Boolean))
  if (origin && allowedOrigins.has(origin)) {
    c.header("Access-Control-Allow-Origin", origin)
    c.header("Access-Control-Allow-Credentials", "true")
    c.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS")
    c.header(
      "Access-Control-Allow-Headers",
      c.req.header("Access-Control-Request-Headers") ?? "Authorization,Content-Type",
    )
    c.header("Vary", "Origin")
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204)
    }
  }

  await next()
})

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }))

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
    )) as unknown as { rows?: { latest: string; count: number }[] } | { latest: string; count: number }[]
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

async function getLatestExeUrl(): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/repos/arka6fx/yomi-releases/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "yomi-backend" },
    })
    if (!res.ok) return null
    const release = (await res.json()) as {
      assets: { name: string; browser_download_url: string }[]
    }
    const exe = release.assets.find((a) => a.name.endsWith(".exe"))
    return exe?.browser_download_url ?? null
  } catch {
    return null
  }
}

app.get("/api/download", async (c) => {
  const url = await getLatestExeUrl()
  if (url) return c.redirect(url)
  return c.redirect("https://github.com/arka6fx/yomi-releases/releases/latest")
})

app.get("/api/download-url", async (c) => {
  const url = await getLatestExeUrl()
  return c.json({ url }, url ? 200 : 404)
})

// Custom auth routes first (device-code flow)
app.route("/api/auth", authRoutesRouter)

// OAuth callback: Better Auth handles directly. redirectURI is set to the API
// domain per-provider, and crossSubDomainCookies shares the session with landing.
app.on(["GET"], "/api/auth/callback/:provider", async (c) => {
  return getAuth().handler(c.req.raw)
})

// Better Auth handles all remaining /api/auth/* routes
// Explicitly skip custom auth paths to avoid Better Auth intercepting them
const SKIP_AUTH_PATHS = new Set([
  "/api/auth/device-code",
  "/api/auth/device-code/token",
  "/api/auth/device-code/confirm",
  "/api/auth/sign-out-all",
])
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  if (SKIP_AUTH_PATHS.has(c.req.path)) return c.notFound()

  return getAuth().handler(c.req.raw)
})

app.route("/api/llm", llmRouter)
app.route("/api/stt", sttRouter)
app.route("/api/tts", ttsRouter)
app.route("/api/usage", usageRouter)
app.route("/api/billing", billingRouter)
app.route("/api/user", profileRouter)
app.route("/api/rag", ragRouter)
app.route("/api/rag/drive", ragDriveRouter)
app.route("/api/memory", memoryRouter)
app.route("/api/schedules", schedulesRouter)
app.route("/api/suggestions", suggestionsRouter)
app.route("/api/actions", actionsRouter)
app.route("/api/v1", proxyRouter)
app.route("/api/gateway", gatewayRouter)
app.route("/api/integrations", integrationsRouter)
app.route("/api/admin", adminRouter)
app.route("/api/conversation", conversationRouter)
app.route("/api/status", statusRouter)
app.route("/api/privacy", privacyRouter)

// Register sidecar URL resolver from platform connections
const sidecarResolver: SidecarResolver = async (userId, platform) => {
  try {
    const row = await db
      .select({ url: devices.sidecarUrl })
      .from(platformConnections)
      .innerJoin(devices, eq(devices.userId, platformConnections.userId))
      .where(
        and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)),
      )
      .limit(1)
      .then((r) => r[0])
    return row?.url ?? undefined
  } catch {
    return undefined
  }
}
export function startGateway(): Promise<void> {
  const gateway = getDefaultGateway()
  gateway.setSidecarResolver(sidecarResolver)
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
  const { runPrivacyRetention } = await import("./services/privacy/retention.js")
  const { runDriveSyncSweep } = await import("./services/rag/drive-sync.js")
  await Promise.all([
    runDueSchedules()
      .then(({ ran }) => {
        if (ran > 0) console.warn(`[schedules] ran ${ran} due schedule(s)`)
      })
      .catch((err) => console.error("[schedules] sweep error:", err)),
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
