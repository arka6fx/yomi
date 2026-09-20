# Yomi Production Runbook

Production topology:

```text
Frontend / dashboard  https://getyomi.in        Cloudflare Worker (apps/landing)
Backend API           https://api.getyomi.in    Cloudflare Container (apps/backend)
Database              Neon PostgreSQL (pgvector, asyncpg over TCP)
LLM + speech          OpenAI (STT for incoming voice notes; replies are text)
Billing               Dodo Payments
```

- **Domain** `getyomi.in` is registered at Hostinger; DNS is managed by
  Cloudflare. `getyomi.in` is a Workers custom domain on the landing app;
  `api.getyomi.in` is a custom domain on the thin Containers Worker that routes
  to the Python backend container, so TLS and proxying are handled by
  Cloudflare.
- **The backend is a Cloudflare Container**, not a Worker: `asyncpg` needs a
  real TCP socket, which the Pyodide-based Workers Python runtime can't provide.

---

## Backend on Cloudflare Containers

The backend is a Python FastAPI app (`apps/backend/src/yomi/`, entrypoint
`yomi.run:app`, uvicorn on `:8080`) built from `apps/backend/Dockerfile`. It is
a single instance per frame served by the thin Worker
`apps/backend/containers/worker.ts` (config in `apps/backend/wrangler.toml`),
which forwards every request plus Worker Secrets (via `envVars`) to the
container. `ENVIRONMENT=production` is the only value in `wrangler.toml`
`[vars]`; everything else arrives as a Worker Secret.

### Migrations

Migrations are **not** run by deploy. After a schema change lands, run Alembic
against the Neon `DATABASE_URL` (direct host, not the pooler):

```bash
cd apps/backend && uv sync --frozen --no-dev
uv run alembic upgrade head
```

The schema itself is owned by `packages/db` (`yomi-db`, SQLAlchemy 2 async
models); `apps/backend/migrations` holds the Alembic migration scripts.

### Secrets (Worker secrets)

```bash
ENVIRONMENT=production                       # the only [vars] value
DATABASE_URL=postgresql://...                # Neon DIRECT host (asyncpg + pgbouncer
                                             # transaction pooling are incompatible)
APP_URL=https://getyomi.in
BACKEND_URL=https://api.getyomi.in
WEB_ORIGIN=https://getyomi.in
CORS_ORIGIN=https://getyomi.in
BETTER_AUTH_SECRET=...

INTERNAL_API_KEY=...
OPENAI_API_KEY=...                    OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_FAST_MODEL=gpt-5.4-mini        OPENAI_AGENT_MODEL=gpt-5.5
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Telegram
TELEGRAM_BOT_TOKEN=...                TELEGRAM_BOT_USERNAME=yomi_assistant_bot
TELEGRAM_DEEP_LINK_ENABLED=true       TELEGRAM_WEBHOOK_SECRET=...

# Token encryption (MUST match the key tokens were encrypted with; fallbacks rotate)
ENCRYPTION_KEY=<hex32>                ENCRYPTION_KEY_FALLBACKS=

# Google OAuth (connectors) + Composio
GOOGLE_INTEGRATIONS_CLIENT_ID=...     GOOGLE_INTEGRATIONS_CLIENT_SECRET=...
COMPOSIO_API_KEY=...                  COMPOSIO_CONNECTORS=...

# Agent tuning
AGENT_MAX_STEPS=25                    AGENT_MAX_OUTPUT_TOKENS=16384

# Dodo Payments
DODO_ENV=live                         DODO_API_KEY=...

# Cloudflare REST APIs (Browser Run, Workers AI, Vectorize) + R2
CLOUDFLARE_API_TOKEN=...              CLOUDFLARE_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...                  R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=...                       R2_BUCKET=yomi-assets
```

Secrets are never committed. `.env.production` (gitignored) is only the local
source you copy values from. Set them with `bunx wrangler secret put <NAME>`
from `apps/backend`.

### Deploy

The backend deploys itself on push to `main`
(`.github/workflows/deploy-backend.yml`). The workflow runs lint + tests first
and blocks the deploy if they fail, then builds `apps/backend/Dockerfile`,
pushes it to the Cloudflare registry, and deploys the Containers Worker. A
post-deploy `/health` check runs when the `YOMI_SERVER_URL` secret is set.

Break-glass / on-demand deploy when CI is unavailable:

```bash
cd apps/backend && npx wrangler deploy
```

Verify provisioning:

```bash
bunx wrangler containers list
curl https://yomi-server.<subdomain>.workers.dev/health
```

---

## Frontend on Cloudflare Workers

`apps/landing` (Next.js 16) deploys as a static-assets Worker named
`yomi-landing`, with `getyomi.in` and `www.getyomi.in` as custom domains
(declared in `apps/landing/wrangler.jsonc`).

```bash
bunx wrangler login   # needs Workers Scripts + Routes write
cd apps/landing
NEXT_PUBLIC_BACKEND_URL=https://api.getyomi.in \
NEXT_PUBLIC_API_URL=https://api.getyomi.in \
NEXT_PUBLIC_APP_URL=https://getyomi.in \
  npm run build:cloudflare
bunx wrangler deploy --env production
```

`NEXT_PUBLIC_*` are baked at build time, so rebuild and redeploy after changing
any public URL or SEO metadata.

---

## OAuth callback URLs

Add these (alongside `http://localhost:8080/...` for dev) in the Google Cloud
and GitHub OAuth apps used for **sign-in**:

```text
https://api.getyomi.in/api/auth/callback/google
https://api.getyomi.in/api/auth/callback/github
```

GitHub/Google/Slack/Notion/Linear connectors route exclusively through Composio
now: there are no native `/api/integrations/callback/*` OAuth apps to register
for them anymore (see `COMPOSIO_CONNECTORS` in `.env.example`).

---

## Verify

```bash
curl -I https://getyomi.in/                 # -> 200
curl https://api.getyomi.in/health          # -> {"status":"ok"}
curl https://api.getyomi.in/health/db       # -> {"status":"ok"} (schema in sync)
```

---

## Dodo Payments

1. Generate a live API key; create Pro/Max subscription products and the three
   credit-pack one-time products.
2. Add a webhook `https://api.getyomi.in/api/billing/webhook`; copy its signing
   secret.
3. Set `DODO_ENV=live`, the API key, webhook secret, and product IDs as Worker
   secrets, then redeploy the backend.

---

## Security notes

- Keep every `.env*` (except `*.example`) out of git.
- `ENCRYPTION_KEY` must match what connector tokens were encrypted with. A
  mismatch makes every stored token undecryptable. Use
  `ENCRYPTION_KEY_FALLBACKS` to rotate safely.
- `DATABASE_URL` must point at Neon's **direct** host, not the `-pooler` host:
  asyncpg doesn't work with PgBouncer-style transaction pooling.