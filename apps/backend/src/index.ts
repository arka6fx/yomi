import { Hono } from "hono"
import { cors } from "hono/cors"
import { auth } from "./auth.js"
import { errorHandler } from "./middleware/error-handler.js"
import { llmRouter } from "./routes/llm.js"
import { sttRouter } from "./routes/stt.js"
import { usageRouter } from "./routes/usage.js"
import { billingRouter } from "./routes/billing.js"
import { authRoutesRouter } from "./routes/auth-routes.js"
import { profileRouter } from "./routes/profile.js"
import { ragRouter } from "./routes/rag.js"

const app = new Hono()

app.onError(errorHandler)

app.use("*", cors({
  origin: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
  credentials: true,
}))

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }))

// Custom auth routes first (device-code flow)
app.route("/api/auth", authRoutesRouter)

// Better Auth handles all remaining /api/auth/* routes
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))

app.route("/api/llm", llmRouter)
app.route("/api/stt", sttRouter)
app.route("/api/usage", usageRouter)
app.route("/api/billing", billingRouter)
app.route("/api/user", profileRouter)
app.route("/api/rag", ragRouter)

const PORT = Number(process.env["PORT"] ?? 3001)
export default {
  port: PORT,
  fetch: app.fetch,
}
