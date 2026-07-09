# Yomi Production Runbook

Production topology (two providers):

```text
Frontend / dashboard  https://getyomi.in        Cloudflare Worker (apps/landing)
Backend API           https://api.getyomi.in    AWS EC2 + Docker + Caddy (apps/backend)
Database              Neon Postgres
LLM + speech          OpenAI (STT/TTS fall back to ElevenLabs)
Billing               Dodo Payments
Desktop installers    GitHub releases on arka6fx/yomi-releases
```

- **Domain** `getyomi.in` is registered at Hostinger; DNS is managed by Cloudflare
  (nameservers point at Cloudflare). `api.getyomi.in` is an **A record → the EC2
  Elastic IP, DNS-only (grey cloud)** so Caddy can obtain a Let's Encrypt cert.
- **Backend is NOT on Cloudflare Workers.** It runs as a container on EC2.
  `apps/backend/src/worker.ts` + `wrangler.jsonc` are kept only as a fallback and
  are not deployed.

---

## Backend — EC2 + Docker

The backend is a Bun/Hono server (`apps/backend/src/index.ts`, port 3001) behind
Caddy, which terminates TLS for `api.getyomi.in`. Compose file: `docker-compose.yml`
(services `backend` + `caddy`), Dockerfile: `apps/backend/Dockerfile`, TLS config:
`Caddyfile`.

### One-time box setup

- EC2 Ubuntu 24.04 LTS, Elastic IP associated, security group `yomi-backend-sg`:
  SSH 22 from your IP only, HTTP 80 + HTTPS 443 from anywhere.
- `curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu`
- Code lives in `~/yomi` on the box; secrets live in `~/yomi/.env.production`
  (chmod 600, never committed).

### Secrets — `~/yomi/.env.production` on the box

```bash
ENVIRONMENT=production
PORT=3001
DATABASE_URL=postgresql://...            # Neon
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
# the backend proxies desktop/sidecar LLM calls and injects the key.
OPENAI_API_KEY=sk-proj-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_FAST_MODEL=gpt-4.1-mini
OPENAI_AGENT_MODEL=gpt-4.1
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
# STT/TTS: OpenAI primary (gpt-4o-mini-transcribe / gpt-4o-mini-tts),
# ElevenLabs fallback.
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...

TELEGRAM_BOT_TOKEN=...          TELEGRAM_BOT_USERNAME=yomi_assistant_bot

DODO_ENV=live
DODO_API_KEY=... or DODO_LIVE_API_KEY=...
DODO_LIVE_WEBHOOK_SECRET=whsec_...
DODO_LIVE_PRODUCT_PRO=pdt_...   DODO_LIVE_PRODUCT_MAX=pdt_...
DODO_LIVE_PRODUCT_CREDITS_500=pdt_...  DODO_LIVE_PRODUCT_CREDITS_2000=pdt_...  DODO_LIVE_PRODUCT_CREDITS_6000=pdt_...

OWNER_EMAIL=you@example.com    # bypasses all credit checks
```

### Deploy

From a machine whose IP is allowed in the SSH rule:

```bash
KEY=path/to/yomi-key.pem HOST=ubuntu@<elastic-ip> scripts/deploy-backend.sh
```

This ships the committed tree (`git archive`), rebuilds the image, restarts, and
curls `/health`. `.env.production` on the box is preserved. **There is no GitHub
CD for the backend** — the SG locks SSH to the owner IP, so hosted runners can't
reach the box. To automate later, install a self-hosted runner on the EC2 box or
use AWS SSM Run Command.

Migrations are **not** run by deploy. After a migration lands, run `bun run
db:migrate` from `packages/db` against `DATABASE_URL`.

---

## Frontend — Cloudflare Worker

`apps/landing` (Next.js 16) deploys as a static-assets Worker named `yomi-landing`,
with `getyomi.in` and `www.getyomi.in` as custom domains (declared in
`apps/landing/wrangler.jsonc`).

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

Add these (alongside `http://localhost:3001/...` for dev) in the Google Cloud and
GitHub OAuth apps — both sign-in and the connector app:

```text
https://api.getyomi.in/api/auth/callback/google
https://api.getyomi.in/api/auth/callback/github
https://api.getyomi.in/api/integrations/callback/google
https://api.getyomi.in/api/integrations/callback/{github,slack,notion,linear}
```

---

## Desktop releases

Never tag or release from this repo. Build + publish via the workflow, which
ships installers to `arka6fx/yomi-releases`:

```bash
gh workflow run release.yml --ref main -f version=<ver> -f notes="<desc>"
```

The desktop app's LLM model names come from the GitHub secrets
`OPENAI_FAST_MODEL` / `OPENAI_AGENT_MODEL` (must be valid OpenAI models),
baked at release build; it routes LLM calls through `api.getyomi.in/api/llm/proxy`.

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
3. Put `DODO_ENV=live`, the API key, webhook secret, and product IDs in
   `~/yomi/.env.production`, then redeploy the backend.

---

## Security notes

- Keep every `.env*` (except `*.example`) out of git.
- `ENCRYPTION_KEY` must match what connector tokens were encrypted with — a
  mismatch makes every stored token undecryptable. Use `ENCRYPTION_KEY_FALLBACKS`
  to rotate safely.
- The Elastic IP incurs a small hourly charge; release it if you tear the box
  down. Set an AWS Budget alert.
