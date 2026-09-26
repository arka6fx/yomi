# Production runbook

How Yomi runs in production and how to deploy, migrate, and verify it. For the
system design, see [`architecture.md`](./architecture.md).

## Topology

| Service               | URL / name               | Source                           | Runs on                                |
| --------------------- | ------------------------ | -------------------------------- | -------------------------------------- |
| Web app and dashboard | `https://getyomi.in`     | `apps/web`                       | Worker `yomi-landing`                  |
| Backend API           | `https://api.getyomi.in` | `apps/api`                       | Worker `yomi-backend` + Container      |
| Storage gateway       | `yomi-storage`           | `apps/api/containers/storage.ts` | Worker with D1, Vectorize, R2          |
| Computer gateway      | `yomi-computer`          | `apps/sandbox`                   | Worker + Cloudflare Sandbox containers |
| Inbound email         | `*@mail.getyomi.in`      | `apps/api/containers/worker.ts`  | Email Routing → `yomi-backend`         |
| Models                | Workers AI               | —                                | Cloudflare                             |
| Payments              | Dodo Payments            | —                                | —                                      |

`getyomi.in` is registered at Hostinger. DNS, TLS, and proxying are handled by
Cloudflare.

## Deploys

### Automatic

Pushes to `main` deploy through GitHub Actions. Each workflow runs its checks
first and does not deploy if they fail.

| Paths                           | Workflow              | Result                                                                                                  |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/api/**`, `packages/db/**` | `deploy-backend.yml`  | Builds `apps/api/Dockerfile`, deploys `yomi-backend`, then checks `/health` if `YOMI_SERVER_URL` is set |
| `apps/web/**`                   | `deploy-landing.yml`  | Builds Next.js and deploys `yomi-landing`                                                               |
| `apps/sandbox/**`               | `deploy-computer.yml` | Builds the desktop image and deploys the computer gateway                                               |

### Manual (break-glass)

```bash
# Backend
cd apps/api && npx wrangler deploy

# Web app
cd apps/web && npm run deploy:production
```

`NEXT_PUBLIC_*` values are baked in at build time. Rebuild the web app after
changing any public URL.

### Storage gateway

The storage gateway is **not** deployed by CI. Deploy it by hand after changing
`apps/api/containers/storage.ts`:

```bash
cd apps/api/containers
npm install
npm run deploy:storage:prod      # production (wrangler.storage-prod.toml)
npm run deploy:storage           # staging (wrangler.storage.toml)
```

## Database migrations (D1)

Migrations are numbered SQL files in `apps/api/migrations-d1/` and are **not**
applied by deploys. Apply them **before** deploying code that depends on them:

```bash
cd apps/api

# Staging first
npx wrangler d1 migrations apply yomi-staging --remote --config wrangler.storage.toml

# Then production
npx wrangler d1 migrations apply yomi-prod --remote --config wrangler.storage-prod.toml
```

Write migrations to be additive (`CREATE TABLE IF NOT EXISTS`, new nullable
columns) so the running code keeps working until the deploy finishes.

## Secrets

Secrets are Worker Secrets, set from `apps/api` with
`npx wrangler secret put <NAME>`. The backend Worker forwards them into the
container (see `envVars` in `apps/api/containers/worker.ts`). They are never
committed. Keep real values in a gitignored `apps/api/.env.production`, starting
from [`apps/api/.env.production.example`](../apps/api/.env.production.example).

The non-secret values (`ENVIRONMENT`, `APP_URL`, `BACKEND_URL`, `WEB_ORIGIN`,
`CORS_ORIGIN`, `CLOUDFLARE_ACCOUNT_ID`) are in `wrangler.toml` `[vars]`.

| Group        | Names                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage      | `STORAGE_BACKEND` (`d1`), `STORAGE_GATEWAY_URL`, `STORAGE_GATEWAY_SECRET` (≥ 32 chars, same value on `yomi-storage`)                                                                                    |
| Auth         | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                                                                                            |
| Internal     | `INTERNAL_API_KEY` (cron dispatch and inbound email)                                                                                                                                                    |
| Encryption   | `ENCRYPTION_KEY`, `ENCRYPTION_KEY_FALLBACKS`                                                                                                                                                            |
| Telegram     | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_DEEP_LINK_ENABLED`                                                                                                  |
| Models       | `WORKERS_AI_FAST_MODEL`, `WORKERS_AI_AGENT_MODEL`, `WORKERS_AI_SEARCH_MODEL`, `WORKERS_AI_EMBEDDING_MODEL`, `WORKERS_AI_STT_MODEL` (defaults in `worker.ts`)                                            |
| Cloudflare   | `CLOUDFLARE_API_TOKEN` (Workers AI, Browser Run)                                                                                                                                                        |
| Connectors   | `GOOGLE_INTEGRATIONS_CLIENT_ID`, `GOOGLE_INTEGRATIONS_CLIENT_SECRET`, `COMPOSIO_API_KEY`, `COMPOSIO_CONNECTORS`, `COMPOSIO_WEBHOOK_SECRET`, `COMPOSIO_WEBHOOK_URL`, `COMPOSIO_<TOOLKIT>_AUTH_CONFIG_ID` |
| Computer     | `COMPUTER_GATEWAY_URL`, `COMPUTER_GATEWAY_SECRET` (same value on the sandbox Worker)                                                                                                                    |
| Payments     | `DODO_ENV`, `DODO_{LIVE,TEST}_API_KEY`, `DODO_{LIVE,TEST}_WEBHOOK_SECRET`, `DODO_{LIVE,TEST}_PRODUCT_PRO` (the retired `PRODUCT_MAX` and `PRODUCT_CREDITS_*` can be removed)                                                      |
| Agent tuning | `AGENT_MAX_STEPS`, `AGENT_MAX_OUTPUT_TOKENS`                                                                                                                                                            |
| Optional     | `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`                                                               |

Deploy workflow secrets (GitHub repository secrets): `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and the optional `YOMI_SERVER_URL`.

> [!CAUTION] `ENCRYPTION_KEY` must match the key existing tokens and vault items
> were encrypted with. A wrong key makes every stored secret unreadable. Rotate
> by moving the old key into `ENCRYPTION_KEY_FALLBACKS`.

## Telegram

On startup the backend checks that the webhook receives `callback_query`
updates, which inline buttons need, and re-registers it if they are missing. To
inspect or reset the webhook by hand (keep the URL `getWebhookInfo` reports):

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq

curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url="$WEBHOOK_URL" \
  -d 'allowed_updates=["message","callback_query"]' \
  -d secret_token="$TELEGRAM_WEBHOOK_SECRET"
```

## OAuth callback URLs

Register these, along with their `http://localhost:8080` equivalents for
development, in the Google Cloud and GitHub OAuth apps used for **sign-in**:

```text
https://api.getyomi.in/api/auth/callback/google
https://api.getyomi.in/api/auth/callback/github
```

Connector OAuth (GitHub, Slack, Notion, Linear, and most Google services) runs
through Composio, so there are no connector callback URLs to register here. See
[`specs/20-google-oauth-console-setup.md`](./specs/20-google-oauth-console-setup.md)
for the Google console setup.

## Dodo Payments

1. Create a live API key and the Pro subscription product. (Max and the credit
   packs are retired; their product IDs are only read for old purchases.)
2. Add the webhook `https://api.getyomi.in/api/billing/webhook` and copy its
   signing secret.
3. Set `DODO_ENV=live` and the `DODO_LIVE_*` secrets, then redeploy the backend.

## Verify

```bash
curl -I https://getyomi.in/                  # 200
curl https://api.getyomi.in/health           # {"status":"ok"}
cd apps/api && npx wrangler containers list  # container provisioned
```

## Troubleshooting

| Symptom                          | Check                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Bot does not reply               | `getWebhookInfo` for `last_error_message`; `yomi-backend` logs in the Cloudflare dashboard          |
| Inline buttons spin forever      | `allowed_updates` must include `callback_query` (see [Telegram](#telegram))                         |
| First request after idle is slow | The cron keeps it warm; check the `*/10` cron still fires and `sleepAfter` is above 10m             |
| Storage errors on every route    | `STORAGE_GATEWAY_URL` / `STORAGE_GATEWAY_SECRET` mismatch between `yomi-backend` and `yomi-storage` |
| "no such table"                  | A D1 migration was not applied (see [migrations](#database-migrations-d1))                          |
| Routines never fire              | `INTERNAL_API_KEY` missing, so the cron dispatch exits early                                        |
