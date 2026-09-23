# Yomi backend (FastAPI)

The canonical Yomi backend: **Python FastAPI in a Cloudflare Container**, with a
shared Postgres schema in `packages/db` (`yomi-db`, SQLAlchemy 2 async). It
deploys as a container (not a Worker) because `asyncpg` needs a real TCP socket.

## Layout

- `src/yomi/` — FastAPI app (routers, services, agent loop, Telegram gateway)
- `src/yomi/db_session.py` — async engine/session factory (asyncpg → Neon)
- `src/yomi/run.py` — production entrypoint (uvicorn on :8080)
- `migrations/` — Alembic scripts; the schema itself is owned by the
  SQLAlchemy models in `packages/db/src/yomi/db/`
- `containers/` + `wrangler.toml` + `Dockerfile` — Cloudflare Containers deploy
  (thin Worker that routes all requests to the FastAPI container image)

## Run (dev)

```bash
uv sync --dev
uv run uvicorn yomi.run:app --reload --port 8080
```

Set required values in `.env` (see `src/yomi/conf.py` and
[`.env.example`](./.env.example)).

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
`wrangler.toml` + `containers/worker.ts` route every request to one named
instance (the Worker is named `yomi-backend`, same as the counter-domain it
serves). `ENVIRONMENT=production` and `CLOUDFLARE_ACCOUNT_ID` are the only
values in `wrangler.toml` `[vars]`; everything else arrives as a Worker
Secret, forwarded to the container through `envVars` in `worker.ts`.

First-time setup (manual):

```bash
cd apps/api
npm install --prefix containers
npx wrangler login
npx wrangler deploy                                     # creates yomi-backend Worker
npx wrangler secret put STORAGE_BACKEND
npx wrangler secret put STORAGE_GATEWAY_URL
npx wrangler secret put STORAGE_GATEWAY_SECRET
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put INTERNAL_API_KEY
npx wrangler secret put DODO_API_KEY
```

Secrets needed: `STORAGE_BACKEND`, `STORAGE_GATEWAY_URL`,
`STORAGE_GATEWAY_SECRET`, `BETTER_AUTH_SECRET`, `INTERNAL_API_KEY`,
`ENCRYPTION_KEY`, `ENCRYPTION_KEY_FALLBACKS`, `DODO_API_KEY`, `DODO_ENV`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and any connector
credentials (Google integrations, Composio) the ported routes touch. Repo
secrets used by the deploy workflow: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and optional `YOMI_SERVER_URL` (enables the post-
deploy `/health` check). Retired: `DATABASE_URL` (Neon), `OPENAI_*`.

After the first deploy, wait a few minutes for provisioning, then verify:

```bash
npx wrangler containers list
curl https://yomi-backend.<subdomain>.workers.dev/health
```

Production is already cut over: `api.getyomi.in` is a custom domain bound
to the `yomi-backend` Worker, which routes every request to the container.
`/health/db` doubles as the schema-drift canary against `packages/db`.

## In progress

- **First-class connector tool sets** (Gmail, Calendar, Drive, GitHub, Slack,
  Notion, Linear) — Python ports in progress; Composio covers the long tail.
- **Better Auth OAuth handler** — Python only *validates* session cookies via
  `yomi/app/deps.py`; the OAuth endpoint still runs on the landing app until it
  is ported.
- **R2 file storage** — `services/storage.py` is a stub awaiting R2 secrets.
