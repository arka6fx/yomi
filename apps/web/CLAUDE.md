# apps/web: Cloudflare Workers I/O rules

The landing app deploys as a Cloudflare Worker. The backend is a **Python
FastAPI Cloudflare Container** (`apps/api`), not a Worker — so these boundary
rules concern the landing app itself. CF Workers bind native I/O to the
originating request context:

- **Web never touches Postgres directly.** All DB access goes through the
  backend API. Don't import `@yomi/db` (the Python schema in `packages/db`) or
  any Postgres driver here.
- **Never pass a cached promise to `ctx.waitUntil()` from a different request.**
- **Never store Request, Response, ReadableStream, or body references in
  module-level variables.** Only plain data may live at module scope.
- **Singleton auth instance is safe**: `betterAuth()` makes `fetch()` calls per
  request.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
