# apps/landing — Cloudflare Workers I/O rules

The landing app deploys as a Cloudflare Worker. The **backend runs on EC2 (Bun),
not Workers**, so these rules are landing-only. CF Workers bind native I/O to the
originating request context:

- **Use `neon()` HTTP mode, never `Pool`.** `Pool` opens a WebSocket and cannot
  be reused across requests. Import `neon` from `@neondatabase/serverless` and
  `drizzle` from `drizzle-orm/neon-http`.
- **Never pass a cached promise to `ctx.waitUntil()` from a different request.**
- **Never store Request, Response, ReadableStream, or body references in
  module-level variables.** Only plain data may live at module scope.
- **Singleton auth instance is safe** — `betterAuth()` makes `fetch()` calls per
  request.
