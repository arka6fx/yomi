# apps/landing — Cloudflare Workers I/O rules

The landing app deploys as a Cloudflare Worker. The **backend runs on EC2 (Bun),
not Workers**, so these rules are landing-only. CF Workers bind native I/O to the
originating request context:

- **Landing never touches Postgres directly.** All DB access goes through the
  backend API (EC2, `pg`/`drizzle-orm/node-postgres` against AWS RDS) — don't
  import `@yomi/db` or any Postgres driver here.
- **Never pass a cached promise to `ctx.waitUntil()` from a different request.**
- **Never store Request, Response, ReadableStream, or body references in
  module-level variables.** Only plain data may live at module scope.
- **Singleton auth instance is safe** — `betterAuth()` makes `fetch()` calls per
  request.
