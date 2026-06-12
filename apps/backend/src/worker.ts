import { app } from "./index"

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: unknown) {
    try {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") process.env[key] = value
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
