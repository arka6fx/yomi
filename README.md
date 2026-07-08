# Yomi

AI productivity assistant. Connects to Google Workspace (Gmail, Calendar,
Drive), GitHub, Slack, Notion, Linear, and more so you can query,
draft, summarize, and schedule in natural language. It accepts desktop voice,
desktop text, screen Q&A, and Telegram messages without copy-pasting context.

## Architecture

Yomi is split into a desktop shell, a local sidecar, a cloud backend, and a
landing site.

```text
apps/backend/           Hono Worker    auth, billing, LLM proxy, usage metering
apps/desktop/           Electron       tray/notch UI, hotkeys, screen and mic capture
apps/landing/           Next.js 16     landing, auth pages, dashboard, downloads
apps/sidecar/           Bun service    router, fast path, agent loop, memory

packages/agent-core/    Connector definitions, registry, agent tools
packages/db/            Drizzle schema and Neon client
packages/shared/        Desktop, sidecar, backend contracts
packages/ui-connectors/ Connector UI components
packages/*-config/      Shared TypeScript and ESLint config
```

The backend is canonical for account auth, billing, Telegram, connectors, and
durable memory. The sidecar is local-first for voice/screen context, local
notes, and private memory sync. The desktop app stays thin: capture, UI, and
hotkeys.

## Request Paths

| Request                | Path                                                             | Target      |
| ---------------------- | ---------------------------------------------------------------- | ----------- |
| Quick ask / screen Q&A | STT or text → optional screenshot → one LLM call → optional TTS  | under 2–3 s |
| Connector query        | router → agent loop → connector tools → response                 | seconds     |
| Telegram query         | backend gateway → backend agent → connector/memory tools → reply | seconds     |

The router decides fast path vs agent path at the start of each turn.

## Local Development

Prerequisites:

- Bun 1.3.x
- Node 20+
- A Neon Postgres database
- AI Credits/OpenAI-compatible LLM credentials
- ElevenLabs API key for STT/TTS

```bash
git clone https://github.com/arka6fx/yomi.git
cd yomi
bun install
cp .env.example .env   # then fill in values — the file documents every variable
bun run dev
```

Common dev targets:

| App     | Command                          | URL                     |
| ------- | -------------------------------- | ----------------------- |
| Landing | `cd apps/landing && bun run dev` | `http://localhost:3000` |
| Backend | `cd apps/backend && bun run dev` | `http://localhost:3001` |
| Sidecar | `cd apps/sidecar && bun run dev` | `http://localhost:3002` |
| Desktop | `cd apps/desktop && bun run dev` | Electron                |

For desktop development, start the sidecar before the desktop app.

## Environment

[`.env.example`](./.env.example) is the source of truth for every variable:
database, Better Auth, Google/GitHub OAuth, AI Credits LLM endpoint,
ElevenLabs, encryption keys, and Dodo Payments.

Production uses split Cloudflare hostnames:

```bash
BETTER_AUTH_URL=https://getyomi.in
BETTER_AUTH_BASE_URL=https://api.getyomi.in
BACKEND_URL=https://api.getyomi.in
# NEXT_PUBLIC_BACKEND_URL — NOT SET in production (auth client uses same-origin proxy)
NEXT_PUBLIC_APP_URL=https://getyomi.in
YOMI_BACKEND_URL=https://api.getyomi.in
CORS_ORIGIN=https://getyomi.in
```

## Billing (Dodo Payments)

Plans are configured in `apps/backend/src/routes/billing.ts` with canonical USD
pricing. Dodo products must be **pre-created in the dashboard** — the backend
references them by ID (the `DODO_*_PRODUCT_*` variables). Set `DODO_ENV=test`
locally and `DODO_ENV=live` in production; only the selected mode needs values.

Key design decisions:

- USD is the canonical billing currency. Local equivalents are estimated using
  the `GET /api/billing/plans` endpoint (with `CF-IPCountry` header)
- Subscriptions and credit packs use Dodo Checkout Sessions
- 7-day grace period after payment failure before access is cut off
- Webhooks are idempotent (deduplicated by event ID)

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
(`apps/backend/src/routes/usage.test.ts`, not a root `tests/` folder).
Turborepo schedules and caches by package, so colocated tests let
`turbo run test --filter ...` and `--affected` run only the packages that
changed.

## Production

Production targets Cloudflare:

- backend: Cloudflare Worker from `apps/backend`
- public site/dashboard: Cloudflare Worker (OpenNext) from `apps/landing`
- database: Neon Postgres
- billing: Dodo Payments
- desktop installers: published as GitHub releases on `arka6fx/yomi-releases`

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

| Capability | Provider / default                                    |
| ---------- | ----------------------------------------------------- |
| Fast LLM   | AI Credits/OpenAI-compatible endpoint, `gpt-5.5-mini` |
| Agent LLM  | AI Credits/OpenAI-compatible endpoint, `gpt-5.5`      |
| STT        | ElevenLabs `scribe_v2`                                |
| TTS        | ElevenLabs `eleven_flash_v2_5`                        |

Set `TTS_ENGINE=none` to disable voice output. Use a premade ElevenLabs voice;
community library voices can fail on free-tier API keys.

## Specs

Implementation references live in [`specs/`](specs/README.md) — system specs,
per-connector docs, and runbooks. Start with the
[index](specs/README.md), then [00-overview](specs/00-overview.md). The terse
operational summary agents load is [`AGENTS.md`](./AGENTS.md).

## Privacy

- No silent recording. The tray/notch UI shows when listening or capturing.
- Password managers and banking apps must be blocklisted from screen capture.
- Memory is user-owned and export/delete must remain possible.
- OAuth tokens are encrypted at rest.
