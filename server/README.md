# Yomi backend (FastAPI)

FastAPI port of `apps/backend` (Hono on Cloudflare Workers) + `packages/*`
for the Yomi assistant. Keeps the same Postgres schema and data.

## Layout

- `src/yomi/db` — SQLAlchemy 2 async models mirroring `packages/db/src/schema.ts`
- `src/yomi/shared` — ports of `packages/shared`
- `src/yomi/services` — ports of `apps/backend/src/services`
- `src/yomi/app` — FastAPI app (deps, routers)
- `src/yomi/run.py` — production entrypoint (uvicorn on :8080)
- `migrations` — Alembic parity/stamping tooling; the schema itself stays owned
  by the drizzle journal in `packages/db` (`alembic stamp 0001_baseline`)
- `containers/` + `wrangler.toml` + `Dockerfile` — Cloudflare Containers deploy
  (thin Worker that routes all requests to the FastAPI container image)

## Run (dev)

```bash
uv sync --dev
uv run uvicorn yomi.app.main:app --reload --port 3001
```

Set required values in `server/.env` (see `src/yomi/conf.py`).

## Run (production image)

```bash
uv sync --frozen --no-dev
uv run python -m yomi.run        # uvicorn on 0.0.0.0:8080, redacted logs
```

## Test / lint

```bash
uv run pytest
uv run ruff check
```

## Deploying to Cloudflare Containers

The backend image (uvicorn, TCP asyncpg -> Neon) runs as a **Cloudflare
Container** — not a Worker — because asyncpg needs a real socket; Workers'
Python runtime is Pyodide-based and can't run it. Cloudflare Containers builds
`Dockerfile` (linux/amd64, non-root, HEALTHCHECK on `/health`), and
`server/wrangler.toml` + `containers/worker.ts` route every request to one
named instance. `ENVIRONMENT=production` is the only value in `wrangler.toml`
`[vars]`; everything else arrives as a Worker Secret, forwarded to the
container through `envVars` in `worker.ts`.

First-time setup (manual):

```bash
cd server
bun install --frozen-lockfile --cwd containers
bunx wrangler login
bunx wrangler deploy                                     # creates yomi-server Worker
bunx wrangler secret put DATABASE_URL                    # use the DIRECT Neon host
bunx wrangler secret put OPENAI_API_KEY                  # (not the -pooler host;
bunx wrangler secret put BETTER_AUTH_SECRET              #  asyncpg + pgbouncer
bunx wrangler secret put ENCRYPTION_KEY                  #  transaction pooling are
bunx wrangler secret put INTERNAL_API_KEY                #  incompatible — see
bunx wrangler secret put DODO_API_KEY                    #  db/__init__.py notes)
```

Secrets needed: `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`
(if proxied), `BETTER_AUTH_SECRET`, `INTERNAL_API_KEY`, `ENCRYPTION_KEY`,
`ENCRYPTION_KEY_FALLBACKS`, `DODO_API_KEY`, `DODO_ENV`, and any connector
credentials (Google integrations, Composio) the ported routes touch. Repo
secrets used by the deploy workflow: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and optional `YOMI_SERVER_URL` (enables the post-
deploy `/health` check).

After the first deploy, wait a few minutes for provisioning, then verify:

```bash
bunx wrangler containers list
curl https://yomi-server.<subdomain>.workers.dev/health
```

Production cutover is a DNS step, not a code step: attach a custom domain to
the server Worker and repoint the `api.getyomi.in` record (or flip
`BACKEND_URL` on the landing app) once `/health/db` shows `status: ok`. The
`/health/db` endpoint is the schema-drift canary against the drizzle journal.

## Not yet ported (stays in apps/backend until cutover)

`/api/auth/*` (Better Auth OAuth — Python only *validates* its session cookies
via `yomi/app/deps.py`), `proxy`, `conversation`, `history`, `suggestions`,
`actions`, `integrations`, `mcp`, `custom-mcp`, `rag-drive`, and the Telegram
gateway / agent loop / connector executors.