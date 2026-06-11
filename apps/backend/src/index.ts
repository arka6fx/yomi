import { Hono } from "hono"
import { cors } from "hono/cors"
import { auth } from "./auth.js"
import { errorHandler } from "./middleware/error-handler.js"
import { llmRouter } from "./routes/llm.js"
// import { sttRouter } from "./routes/stt.js"   // legacy ElevenLabs
import { usageRouter } from "./routes/usage.js"
import { billingRouter } from "./routes/billing.js"
import { authRoutesRouter } from "./routes/auth-routes.js"
import { profileRouter } from "./routes/profile.js"
import { ragRouter } from "./routes/rag.js"
import { proxyRouter } from "./routes/proxy.js"
// import { gatewayRouter } from "./gateway/routes.js"
// import { getDefaultGateway } from "./gateway/gateway-runner.js"
// import type { SidecarResolver } from "./gateway/gateway-runner.js"
// import { eq, and } from "drizzle-orm"
// import { db, platformConnections, devices } from "@yomi/db"
import { eq, and } from "drizzle-orm"
import { db, devices } from "@yomi/db"

const app = new Hono()

app.onError(errorHandler)

app.use(
  "*",
  cors({
    origin: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
    credentials: true,
  }),
)

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }))

// Download proxy — redirects to the latest Windows installer from GitHub Releases
app.get("/api/download", async (c) => {
  try {
    const res = await fetch(
      "https://api.github.com/repos/arka6fx/yomi-releases/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    )
    if (!res.ok) throw new Error("GitHub API error")
    const release = await res.json() as { assets: { name: string; browser_download_url: string }[] }
    const exe = release.assets.find((a) => a.name.endsWith(".exe"))
    if (!exe) throw new Error("No .exe asset")
    return c.redirect(exe.browser_download_url)
  } catch {
    return c.redirect("https://github.com/arka6fx/yomi-releases/releases/latest")
  }
})

// Custom auth routes first (device-code flow)
app.route("/api/auth", authRoutesRouter)

// Better Auth handles all remaining /api/auth/* routes
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))

app.route("/api/llm", llmRouter)
// app.route("/api/stt", sttRouter)  // legacy ElevenLabs
app.route("/api/usage", usageRouter)
app.route("/api/billing", billingRouter)
app.route("/api/user", profileRouter)
app.route("/api/rag", ragRouter)
app.route("/api/v1", proxyRouter)
// app.route("/api/gateway", gatewayRouter) // will provide later
// 
// // Register sidecar URL resolver from platform connections — will provide later
// const sidecarResolver: SidecarResolver = async (userId, platform) => { ... }
// getDefaultGateway().setSidecarResolver(sidecarResolver)
// 
// // Start the messaging gateway — will provide later
// getDefaultGateway().start(process.env["YOMI_PLAN"]).then(() => { ... })

const PORT = Number(process.env["PORT"] ?? 3001)

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
})

console.warn(`Backend listening on :${server.port}`)
