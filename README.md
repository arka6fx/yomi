# Yomi

AI productivity assistant. Connects to Google Workspace (Gmail, Calendar,
Drive), GitHub, Slack, Notion, Linear, Discord, and more so you can query,
draft, summarize, and schedule in natural language. It accepts desktop voice,
desktop text, screen Q&A, and Telegram messages without copy-pasting context.

## Architecture

Yomi is split into a desktop shell, a local sidecar, a cloud backend, and a
landing site.

```text
apps/backend/   Hono Worker    auth, billing, LLM proxy, usage metering
apps/desktop/   Electron       tray/notch UI, hotkeys, screen and mic capture
apps/landing/   Next.js 16     landing, auth pages, dashboard, downloads
apps/sidecar/   Bun service    router, fast path, agent loop, memory

packages/db/    Drizzle schema and Neon client
packages/shared Desktop, sidecar, backend contracts
packages/*config Shared TypeScript and ESLint config
```

The backend is canonical for account auth, billing, Telegram, connectors, and
durable memory. The sidecar is local-first for voice/screen context, local notes,
and private memory sync. The desktop app stays thin: capture, UI, and hotkeys.

## Request Paths

| Request | Path | Target |
| --- | --- | --- |
| Quick ask / screen Q&A | STT or text → optional screenshot → one LLM call → optional TTS | under 2–3 s |
| Connector query | router → agent loop → connector tools → response | seconds |
| Telegram query | backend gateway → backend agent → connector/memory tools → reply | seconds |

Do not switch models mid-turn. The router decides fast path vs agent path at
the start of a turn.

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
cp .env.example .env
bun run dev
```

Common dev targets:

| App | Command | URL |
| --- | --- | --- |
| Landing | `cd apps/landing && bun run dev` | `http://localhost:3000` |
| Backend | `cd apps/backend && bun run dev` | `http://localhost:3001` |
| Sidecar | `cd apps/sidecar && bun run dev` | `http://localhost:3002` |
| Desktop | `cd apps/desktop && bun run dev` | Electron |

For desktop development, start the sidecar before the desktop app.

## Environment

Minimum local `.env` values:

```bash
DATABASE_URL=postgresql://...

BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_BASE_URL=http://localhost:3001
BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

AI_CREDITS_API_KEY=...
AI_CREDITS_BASE_URL=...
AI_CREDITS_FAST_MODEL=gpt-5.5-mini
AI_CREDITS_AGENT_MODEL=gpt-5.5

ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL

ENCRYPTION_KEY=...
SIDECAR_SECRET=...

```

Production uses split Cloudflare hostnames:

```bash
BETTER_AUTH_URL=https://yomi.arka6fx.com
BETTER_AUTH_BASE_URL=https://api.yomi.arka6fx.com
BACKEND_URL=https://api.yomi.arka6fx.com
# NEXT_PUBLIC_BACKEND_URL — NOT SET in production (auth client uses same-origin proxy)
NEXT_PUBLIC_APP_URL=https://yomi.arka6fx.com
YOMI_BACKEND_URL=https://api.yomi.arka6fx.com
CORS_ORIGIN=https://yomi.arka6fx.com
```

## Billing (Dodo Payments)

Plans are configured in `apps/backend/src/routes/billing.ts` with canonical
USD pricing. Dodo products must be **pre-created in the dashboard** — the
backend references them by ID for subscription and credit-pack checkouts.

```bash
# Required for billing
DODO_ENV=test

# Test mode
DODO_TEST_API_KEY=
DODO_TEST_WEBHOOK_SECRET=
# Defaults to https://test.dodopayments.com (test) / https://live.dodopayments.com (live)
DODO_TEST_API_BASE=
DODO_TEST_PRODUCT_PRO=
DODO_TEST_PRODUCT_MAX=
DODO_TEST_PRODUCT_CREDITS_500=
DODO_TEST_PRODUCT_CREDITS_2000=
DODO_TEST_PRODUCT_CREDITS_6000=

# Live mode
DODO_LIVE_API_KEY=
DODO_LIVE_WEBHOOK_SECRET=
DODO_LIVE_API_BASE=
DODO_LIVE_PRODUCT_PRO=
DODO_LIVE_PRODUCT_MAX=
DODO_LIVE_PRODUCT_CREDITS_500=
DODO_LIVE_PRODUCT_CREDITS_2000=
DODO_LIVE_PRODUCT_CREDITS_6000=
```

Set `DODO_ENV=test` for local development and `DODO_ENV=live` for production.
Only the selected mode needs values.

**Key design decisions:**
- USD is the canonical billing currency. Local equivalents are estimated
  using the `GET /api/billing/plans` endpoint (with `CF-IPCountry` header)
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

Tests are package-local. Do not create one root `tests/` folder for normal unit
or integration tests.

Use colocated files next to the code they exercise:

```text
apps/backend/src/routes/usage.test.ts
apps/sidecar/src/router/intent.test.ts
apps/desktop/src/renderer/store.test.ts
packages/shared/src/chunk.test.ts
```

Why: Turborepo schedules and caches work by package. Keeping tests inside the
owning workspace lets `turbo run test --filter ...` and `--affected` run only the
packages that changed. Root-level tests should be reserved for rare repo-wide
checks that cannot belong to a single package.

## Production

Production targets Cloudflare:

- backend: Cloudflare Worker from `apps/backend`
- public site/dashboard: Cloudflare Pages from `apps/landing`
- database: Neon Postgres
- billing: Dodo Payments
- desktop installers: published as GitHub releases on `arka6fx/yomi-releases`

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for the current runbook.

## OAuth

Configure OAuth callbacks:

```text
https://api.yomi.arka6fx.com/api/auth/callback/github
https://api.yomi.arka6fx.com/api/auth/callback/google
```

Local callbacks:

```text
http://localhost:3001/api/auth/callback/github
http://localhost:3001/api/auth/callback/google
```

## Speech And Models

| Capability | Provider / default |
| --- | --- |
| Fast LLM | AI Credits/OpenAI-compatible endpoint, `gpt-5.5-mini` |
| Agent LLM | AI Credits/OpenAI-compatible endpoint, `gpt-5.5` |
| STT | ElevenLabs `scribe_v2` |
| TTS | ElevenLabs `eleven_flash_v2_5` |

Set `TTS_ENGINE=none` to disable voice output. Use a premade ElevenLabs voice;
community library voices can fail on free-tier API keys.

## Specs

The numbered docs in `specs/` are implementation references, not product copy.
Current order:

| # | Spec |
| --- | --- |
| 00 | [Overview](specs/00-overview.md) |
| 01 | [Architecture](specs/01-architecture.md) |
| 02 | [Sidecar fast pipeline](specs/02-sidecar-fast-pipeline.md) |
| 03 | [Desktop shell](specs/03-desktop-shell.md) |
| 04 | [Desktop UI](specs/04-desktop-ui.md) |
| 05 | [Speech STT](specs/05-speech-stt.md) |
| 06 | [Speech TTS](specs/06-speech-tts.md) |
| 07 | [Sidecar router](specs/07-sidecar-router.md) |
| 08 | [Sidecar agent](specs/08-sidecar-agent.md) |
| 09 | [Harness](specs/09-harness.md) |
| 10 | [Memory](specs/10-memory.md) |
| 11 | [Database](specs/11-database.md) |
| 12 | [Backend](specs/12-backend.md) |
| 13 | [Pricing](specs/13-pricing.md) |
| 14 | [Landing page](specs/14-landing-page.md) |

## Privacy

- No silent recording. The tray/notch UI shows when listening or capturing.
- Password managers and banking apps must be blocklisted from screen capture.
- Memory is user-owned and export/delete must remain possible.
- OAuth tokens are encrypted at rest.
