import { app, startGateway } from "./index.js"

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

let gatewayStarted = false

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    try {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
          process.env[key] = value.replace(/^\uFEFF/, "")
        }
      }

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
}
