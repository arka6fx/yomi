# Yomi Production Runbook

Production targets:

```text
Landing / dashboard: https://getyomi.in
Backend API:         https://api.getyomi.in
Staging API:         https://api-staging.getyomi.in
```

Production runs on Cloudflare Workers.

## Required Secrets

Cloudflare secrets are set with Wrangler per app/environment. Do not commit
secret values to `wrangler.jsonc`.

Required production values:

```bash
DATABASE_URL=postgresql://...

BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://getyomi.in
BETTER_AUTH_BASE_URL=https://api.getyomi.in
BACKEND_URL=https://api.getyomi.in
# NEXT_PUBLIC_BACKEND_URL — DO NOT SET in production. Auth client must use same-origin
# so OAuth cookies land on the correct domain. Worker proxies /api/* to backend.
NEXT_PUBLIC_APP_URL=https://getyomi.in
YOMI_BACKEND_URL=https://api.getyomi.in
YOMI_APP_URL=https://getyomi.in
CORS_ORIGIN=https://getyomi.in

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

AI_CREDITS_API_KEY=...
AI_CREDITS_BASE_URL=...
AI_CREDITS_FAST_MODEL=gpt-5.5-mini
AI_CREDITS_AGENT_MODEL=gpt-5.5
AI_CREDITS_EMBEDDING_MODEL=text-embedding-3-small

ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
TTS_ENGINE=elevenlabs

ENCRYPTION_KEY=<openssl rand -hex 32>
SIDECAR_SECRET=...
```

Optional until billing is enabled:

```bash
DODO_ENV=test

DODO_TEST_API_KEY=
DODO_TEST_WEBHOOK_SECRET=
# Defaults to https://test.dodopayments.com (test) / https://live.dodopayments.com (live)
DODO_TEST_API_BASE=
DODO_TEST_PRODUCT_PRO=
DODO_TEST_PRODUCT_MAX=
DODO_TEST_PRODUCT_CREDITS_500=
DODO_TEST_PRODUCT_CREDITS_2000=
DODO_TEST_PRODUCT_CREDITS_6000=

DODO_LIVE_API_KEY=
DODO_LIVE_WEBHOOK_SECRET=
DODO_LIVE_API_BASE=
DODO_LIVE_PRODUCT_PRO=
DODO_LIVE_PRODUCT_MAX=
DODO_LIVE_PRODUCT_CREDITS_500=
DODO_LIVE_PRODUCT_CREDITS_2000=
DODO_LIVE_PRODUCT_CREDITS_6000=
```

## OAuth Callback URLs

Configure these in the OAuth provider dashboards:

```text
https://api.getyomi.in/api/auth/callback/github
https://api.getyomi.in/api/auth/callback/google
```

## Cloudflare Setup

Install dependencies and authenticate Wrangler:

```bash
bun install
bunx wrangler login
```

Set backend Worker secrets:

```bash
cd apps/backend
bunx wrangler secret put DATABASE_URL --env production
bunx wrangler secret put BETTER_AUTH_SECRET --env production
bunx wrangler secret put GOOGLE_CLIENT_ID --env production
bunx wrangler secret put GOOGLE_CLIENT_SECRET --env production
bunx wrangler secret put GITHUB_CLIENT_ID --env production
bunx wrangler secret put GITHUB_CLIENT_SECRET --env production
bunx wrangler secret put ENCRYPTION_KEY --env production
bunx wrangler secret put AI_CREDITS_API_KEY --env production
bunx wrangler secret put ELEVENLABS_API_KEY --env production
bunx wrangler secret put ELEVENLABS_VOICE_ID --env production
```

When billing is ready, also set:

```bash
bunx wrangler secret put DODO_LIVE_API_KEY --env production
bunx wrangler secret put DODO_LIVE_WEBHOOK_SECRET --env production
bunx wrangler secret put DODO_LIVE_PRODUCT_PRO --env production
bunx wrangler secret put DODO_LIVE_PRODUCT_MAX --env production
bunx wrangler secret put DODO_LIVE_PRODUCT_CREDITS_500 --env production
bunx wrangler secret put DODO_LIVE_PRODUCT_CREDITS_2000 --env production
bunx wrangler secret put DODO_LIVE_PRODUCT_CREDITS_6000 --env production
```

Set `DODO_ENV` in `apps/backend/wrangler.jsonc` vars instead of a secret. Only
set `DODO_LIVE_API_BASE` in vars if Dodo gives you a non-default base URL.

Landing is deployed as a static-assets Worker. The auth client uses same-origin
requests by default — the landing Worker proxies `/api/*` to the backend. For
local dev you may set `NEXT_PUBLIC_BACKEND_URL` to skip the proxy, but DO NOT
set it in production (OAuth cookies would be set for the wrong domain):

```text
# NEXT_PUBLIC_BACKEND_URL=https://api.getyomi.in — local dev only, never in prod
NEXT_PUBLIC_APP_URL=https://getyomi.in
BACKEND_URL=https://api.getyomi.in
BETTER_AUTH_URL=https://getyomi.in
BETTER_AUTH_BASE_URL=https://api.getyomi.in
```

Custom domains are configured once in the Cloudflare dashboard. They are not
managed by `wrangler.jsonc`, so deploy tokens only need Worker edit access:

```text
production: api.getyomi.in
staging:    api-staging.getyomi.in
```

## Deploy

Backend:

```bash
cd apps/backend
bun run cf:check
bun run deploy:production
```

Landing:

```bash
cd apps/landing
bun run build:cloudflare
bun run deploy:production
```

## Verify

```bash
curl -I https://getyomi.in/
curl https://api.getyomi.in/health
```

Expected public behavior:

```text
https://getyomi.in/       -> 200
https://api.getyomi.in/health -> 200
```

## Dodo Payments

Leave Dodo values blank until billing is ready. When enabling billing:

1. Generate an API key in the Dodo dashboard.
2. Create subscription products for Pro and Max.
3. Create one-time products for the credit packs.
4. Set `DODO_ENV=test` for sandbox or `DODO_ENV=live` for production.
5. Set the matching `DODO_TEST_*` or `DODO_LIVE_*` product IDs.
6. Add a webhook for `https://api.getyomi.in/api/billing/webhook`.
7. Set the matching webhook signing secret.
8. Add the Dodo secrets to the backend Worker.
9. Redeploy the backend Worker.

## Security Notes

- Keep `.env` and `.env.production` out of git.
- Do not commit OAuth client secrets, Dodo secrets, AI Credits keys, ElevenLabs
  keys, or database URLs.
- Rotate old AWS keys because the AWS deployment path has been removed.
