# Yomi

AI productivity assistant. Connects to Google Workspace (Gmail, Calendar, Drive,
Classroom), GitHub, Slack, Notion, Linear, and more so you can query, draft,
summarize, and schedule in natural language from the web app and Telegram
without copy-pasting context.

## Architecture

Yomi is split into a cloud backend and a landing/dashboard app.

```text
apps/backend/           Hono on Bun    auth, billing, LLM proxy, usage metering (EC2 + Docker)
apps/landing/           Next.js 16     landing, auth pages, dashboard

packages/agent-core/    Connector definitions, registry, agent tools
packages/db/            Drizzle schema and PostgreSQL client
packages/shared/        Shared backend and frontend contracts
packages/ui-connectors/ Connector UI components
packages/*-config/      Shared TypeScript and ESLint config
```

The backend is canonical for account auth, billing, Telegram, connectors, and
durable memory. The desktop client has been retired — Yomi's only interaction
surface is Telegram, managed via the web dashboard (see
`docs/adr/0002-retire-desktop-telegram-only.md`).

## Request Paths

| Request         | Path                                                                | Target  |
| --------------- | ------------------------------------------------------------------- | ------- |
| Connector query | backend agent -> connector tools -> response                        | seconds |
| Telegram query  | backend gateway -> backend agent -> connector/memory tools -> reply | seconds |

The backend routes connector and Telegram work through the server-side agent.

## Local Development

Prerequisites:

- Bun 1.3.x
- Node 20+
- A PostgreSQL database
- An OpenAI API key

```bash
git clone https://github.com/arka6fx/yomi.git
cd yomi
bun install
cp .env.example .env
bun run dev
```

Common dev targets:

| App     | Command                          | URL                     |
| ------- | -------------------------------- | ----------------------- |
| Landing | `cd apps/landing && bun run dev` | `http://localhost:3000` |
| Backend | `cd apps/backend && bun run dev` | `http://localhost:3001` |

## Environment

[`.env.example`](./.env.example) is the source of truth for every variable:
database, Better Auth, Google/GitHub OAuth, the OpenAI endpoint, encryption
keys, and Dodo Payments. The LLM/speech env vars use the standard `OPENAI_*`
names and point at OpenAI (`api.openai.com`).

Production uses split hostnames:

```bash
BETTER_AUTH_URL=https://getyomi.in
BETTER_AUTH_BASE_URL=https://api.getyomi.in
BACKEND_URL=https://api.getyomi.in
# NEXT_PUBLIC_BACKEND_URL is not set in production; auth uses the same-origin proxy.
NEXT_PUBLIC_APP_URL=https://getyomi.in
YOMI_BACKEND_URL=https://api.getyomi.in
CORS_ORIGIN=https://getyomi.in
```

## Billing

Plans are configured in `apps/backend/src/routes/billing.ts` with canonical USD
pricing. Dodo products must be pre-created in the dashboard; the backend
references them by ID through the `DODO_*_PRODUCT_*` variables. Set
`DODO_ENV=test` locally and `DODO_ENV=live` in production.

Key design decisions:

- USD is the canonical billing currency. Local equivalents are estimated using
  the `GET /api/billing/plans` endpoint with the `CF-IPCountry` header.
- Subscriptions and credit packs use Dodo Checkout Sessions.
- There is a 7-day grace period after payment failure before access is cut off.
- Webhooks are idempotent and deduplicated by event ID.

## Commands

```bash
bun run lint
bun run typecheck
bun run test
bun run build:ci
bun run build
```

Database commands live in `packages/db`:

```bash
cd packages/db
bun run db:generate
bun run db:migrate
bun run db:studio
```

## Test Layout

Tests are package-local and colocated next to the code they exercise
(`apps/backend/src/routes/usage.test.ts`, not a root `tests/` folder). Turborepo
schedules and caches by package, so colocated tests let
`turbo run test --filter ...` and `--affected` run only the packages that
changed.

## Production

- Backend: AWS EC2 + Docker + Caddy from `apps/backend`, at `api.getyomi.in`.
  Backend deploys from the GitHub workflow on pushes to `main`.
  `worker.ts`/`wrangler.jsonc` are a kept-but-unused Cloudflare fallback.
- Frontend/dashboard: Cloudflare Worker (`yomi-landing`) from `apps/landing`, at
  `getyomi.in` and `www.getyomi.in`. Deploy with
  `wrangler deploy --env production`.
- Database: AWS RDS PostgreSQL.
- LLM and speech: OpenAI.
- Billing: Dodo Payments.

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for the current runbook.

## OAuth

Configure OAuth callbacks:

```text
https://api.getyomi.in/api/auth/callback/github
https://api.getyomi.in/api/auth/callback/google

http://localhost:3001/api/auth/callback/github
http://localhost:3001/api/auth/callback/google
```

## Speech And Models

| Capability | Provider / default              |
| ---------- | ------------------------------- |
| Fast LLM   | OpenAI `gpt-5.4-mini`           |
| Agent LLM  | OpenAI `gpt-5.5`                |
| Embeddings | OpenAI `text-embedding-3-small` |
| STT        | OpenAI `gpt-4o-mini-transcribe` |

STT transcribes incoming Telegram voice notes to text via the standard
`OPENAI_*` env vars (`api.openai.com`). Yomi never replies with synthesized
voice — every reply is text.

## Specs

Implementation references live in [`specs/`](specs/README.md): system specs,
per-connector docs, and runbooks. Start with the [index](specs/README.md), then
[00-overview](specs/00-overview.md). The terse operational summary agents load
is [`AGENTS.md`](./AGENTS.md).

## Privacy

- No silent recording.
- Memory is user-owned and export/delete must remain possible.
- OAuth tokens are encrypted at rest.
