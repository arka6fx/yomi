import { Hono } from "hono"
import { cors } from "hono/cors"
import { auth } from "./auth.js"
import { llmRouter } from "./routes/llm.js"
import { sttRouter } from "./routes/stt.js"
import { usageRouter } from "./routes/usage.js"
import { billingRouter } from "./routes/billing.js"
import { authRoutesRouter } from "./routes/auth-routes.js"
import { memoryRouter } from "./routes/memory.js"

const app = new Hono()

app.use("*", cors({
  origin: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
  credentials: true,
}))

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }))

// Better Auth handles all /api/auth/* routes
app.on(["GET", "POST"], "/api/auth/**", (c) => auth.handler(c.req.raw))

// Device-code flow (custom routes on top of Better Auth)
app.route("/api/auth", authRoutesRouter)

app.route("/api/llm", llmRouter)
app.route("/api/stt", sttRouter)
app.route("/api/usage", usageRouter)
app.route("/api/billing", billingRouter)
app.route("/api/memory", memoryRouter)

const PORT = Number(process.env["PORT"] ?? 3001)
export default {
  port: PORT,
  fetch: app.fetch,
}
