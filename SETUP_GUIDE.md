# Yomi Production Runbook

Production topology:

```text
Frontend / dashboard  https://getyomi.in        Cloudflare Worker (apps/landing)
Backend API           https://api.getyomi.in    Cloudflare Worker (apps/backend)
Database              Neon PostgreSQL (pgvector, HTTP driver)
Asset storage         Cloudflare R2 (optional YOMI_ASSETS binding)
LLM + speech          OpenAI (STT for incoming voice notes; replies are text)
Billing               Dodo Payments
```

- **Domain** `getyomi.in` is registered at Hostinger; DNS is managed by
  Cloudflare. Both `getyomi.in` and `api.getyomi.in` are Cloudflare Workers
  custom domains, so TLS and proxying are handled by Cloudflare.
- **Both the backend and the landing app run on Cloudflare Workers.** The
  backend entry is `apps/backend/src/worker.ts` with
  `apps/backend/wrangler.jsonc`.

---

## Backend — Cloudflare Worker

The backend is a Hono app (`apps/backend/src/index.ts`) served by the Worker
entry `apps/backend/src/worker.ts`. It runs on Workers with `nodejs_compat` and
talks to Neon over the stateless HTTP driver (`@neondatabase/serverless`). It is
not a container and there is no server to SSH into.

Migrations are **not** run by deploy. After a migration lands, run
`bun run db:migrate` from `packages/db` against the Neon `DATABASE_URL`.

### Secrets — Worker secrets (`wrangler secret put`)

```bash
ENVIRONMENT=production
DATABASE_URL=postgresql://...             # Neon connection string (pooler)
ENCRYPTION_KEY=<hex32>                    # MUST match the value tokens were encrypted with
ENCRYPTION_KEY_FALLBACKS=                 # old key(s) if rotating, comma-separated
BETTER_AUTH_SECRET=...
OAUTH_STATE_SECRET=...

BETTER_AUTH_URL=https://getyomi.in
BETTER_AUTH_BASE_URL=https://api.getyomi.in
CORS_ORIGIN=https://getyomi.in
NEXT_PUBLIC_APP_URL=https://getyomi.in
YOMI_APP_URL=https://getyomi.in

GOOGLE_CLIENT_ID=...            GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...            GITHUB_CLIENT_SECRET=...
GITHUB_INTEGRATIONS_CLIENT_ID=...  GITHUB_INTEGRATIONS_CLIENT_SECRET=...

# LLM + speech via OpenAI (standard OPENAI_* env vars, api.openai.com);
# the backend injects the key.
OPENAI_API_KEY=sk-proj-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_FAST_MODEL=gpt-5.4-mini
OPENAI_AGENT_MODEL=gpt-5.5
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
# STT: OpenAI (gpt-4o-mini-transcribe). Incoming Telegram voice notes are
# transcribed to text; Yomi always replies in text, never with synthesized voice.

TELEGRAM_BOT_TOKEN=...          TELEGRAM_BOT_USERNAME=yomi_assistant_bot
TELEGRAM_DEEP_LINK_ENABLED=true

DODO_ENV=live
DODO_API_KEY=...
DODO_LIVE_API_BASE=https://live.dodopayments.com
DODO_LIVE_PRODUCT_PRO=pdt_...   DODO_LIVE_PRODUCT_MAX=pdt_...
DODO_LIVE_PRODUCT_CREDITS_85=pdt_...  DODO_LIVE_PRODUCT_CREDITS_250=pdt_...  DODO_LIVE_PRODUCT_CREDITS_750=pdt_...
```

Secrets are never committed. `.env.production` (gitignored) is only the local
source you copy values from.

### Asset storage (optional)

Attachment re-hosting and avatar uploads use the optional `YOMI_ASSETS` R2
binding declared in `apps/backend/wrangler.jsonc`. When the binding is unbound,
those features degrade gracefully instead of failing. There are no AWS S3
credentials to configure.

### Deploy

The backend deploys itself on push to `main`
(`.github/workflows/deploy-backend.yml`). The workflow runs `bun run test` first
and blocks the deploy if it fails, then runs `bun run deploy:production`
(`wrangler deploy --env production`) on a GitHub-hosted runner.

Break-glass / on-demand deploy when CI is unavailable:

```bash
cd apps/backend && bun run deploy:production
```

---

## Frontend — Cloudflare Worker

`apps/landing` (Next.js 16) deploys as a static-assets Worker named
`yomi-landing`, with `getyomi.in` and `www.getyomi.in` as custom domains
(declared in `apps/landing/wrangler.jsonc`).

```bash
bunx wrangler login   # needs Workers Scripts + Routes write
cd apps/landing
NEXT_PUBLIC_BACKEND_URL=https://api.getyomi.in \
NEXT_PUBLIC_API_URL=https://api.getyomi.in \
NEXT_PUBLIC_APP_URL=https://getyomi.in \
  bun run build:cloudflare
bunx wrangler deploy --env production
```

`NEXT_PUBLIC_*` are baked at build time — rebuild + redeploy after changing any
public URL or SEO metadata.

---

## OAuth callback URLs

Add these (alongside `http://localhost:3001/...` for dev) in the Google Cloud
and GitHub OAuth apps used for **sign-in**:

```text
https://api.getyomi.in/api/auth/callback/google
https://api.getyomi.in/api/auth/callback/github
```

GitHub/Google/Slack/Notion/Linear connectors route exclusively through Composio
now — there are no native `/api/integrations/callback/*` OAuth apps to register
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
- `ENCRYPTION_KEY` must match what connector tokens were encrypted with — a
  mismatch makes every stored token undecryptable. Use
  `ENCRYPTION_KEY_FALLBACKS` to rotate safely.
- `DATABASE_URL` uses Neon's HTTP driver, which is stateless per query: there
  are no interactive transactions. Multi-write atomicity goes through
  `db.batch`.
