# apps/web: Cloudflare Workers I/O rules

The landing app deploys as a Cloudflare Worker. The backend is a **Python
FastAPI Cloudflare Container** (`apps/api`), not a Worker — so these
boundary rules concern the landing app itself. CF Workers bind native I/O to the
originating request context:

- **Web never touches Postgres directly.** All DB access goes through the
  backend API. Don't import `@yomi/db` (the Python schema in `packages/db`) or
  any Postgres driver here.
- **Never pass a cached promise to `ctx.waitUntil()` from a different request.**
- **Never store Request, Response, ReadableStream, or body references in
  module-level variables.** Only plain data may live at module scope.
- **Singleton auth instance is safe**: `betterAuth()` makes `fetch()` calls per
  request.
