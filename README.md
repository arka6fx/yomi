# Yomi

Cross-platform AI buddy. Yomi sees your screen, hears your voice, answers fast,
and can run foreground automation when a task needs more than a quick response.

## Architecture

Yomi is split into a desktop shell, a local sidecar, a cloud backend, and a
landing site.

```text
apps/backend/   Hono on Bun    auth, billing, LLM proxy, usage metering
apps/desktop/   Electron       tray/notch UI, hotkeys, screen and mic capture
apps/landing/   Next.js 16     landing, auth pages, dashboard, downloads
apps/sidecar/   Bun service    router, fast path, agent loop, memory, MCP
apps/uia-helper C# / FlaUI     Windows UI Automation helper

packages/db/    Drizzle schema and Neon client
packages/shared Desktop, sidecar, backend contracts
packages/*config Shared TypeScript and ESLint config
```

The sidecar is the local brain. The desktop app stays thin: capture, UI, and
foreground system integration. Provider keys live in environment files or the
backend, never in the desktop bundle.

## Request Paths

| Request | Path | Target |
| --- | --- | --- |
| Quick ask / screen Q&A | STT or text -> screenshot -> one LLM call -> optional TTS | under 2-3s |
| Autonomous task | router -> ReAct/LangGraph loop -> tools/subagents -> progress events | foreground, seconds-minutes |

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

OPENAI_API_KEY=...
OPENAI_BASE_URL=...

ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL

ENCRYPTION_KEY=...
SIDECAR_SECRET=...
```

Production uses `https://yomi.arka6fx.com` for `BETTER_AUTH_URL`,
`BETTER_AUTH_BASE_URL`, `BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, and
`NEXT_PUBLIC_APP_URL`.

Razorpay keys can stay blank until billing is enabled. Billing routes will not
work without them.

## Messaging Gateway

Yomi supports messaging bots on Telegram and Discord. Link your account once,
then chat with Yomi from your phone even when away from your computer.

```text
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Telegram /  │ --> │  Cloud Backend  │ --> │  Sidecar     │
│  Discord DM  │ <-- │  (queue + send) │ <-- │  (LLM reply) │
└──────────────┘     └─────────────────┘     └──────────────┘
```

### Setup

**Telegram** — create a bot via [@BotFather](https://t.me/BotFather) and set
`TELEGRAM_BOT_TOKEN`. The bot polls Telegram every 3s for new messages.

**Discord** — create an application at
[discord.com/developers](https://discord.com/developers/applications). Set:

```bash
DISCORD_BOT_TOKEN=      # Bot token from the Bot page
DISCORD_CLIENT_ID=      # Application ID from General Information
DISCORD_CLIENT_SECRET=  # From OAuth2 → Client Secret
DISCORD_REDIRECT_URI=   # e.g. https://yomi.arka6fx.com/api/gateway/discord/callback
```

Discord uses a two-step OAuth identify flow (no server required):
1. User clicks "Add Discord" → authorizes via OAuth
2. Backend creates a DM channel and sends a 6-character linking code
3. User enters the code on `/link` to connect their account

### Linking Flow

```
User messages bot (first time)
  → Bot replies: "Your code: ABC123"
  → User visits /link, enters code
  → Account linked, bot replies: "Your account is now linked!"
  → All future messages route to your sidecar for AI replies
```

Linking codes expire after 10 minutes. Unlinked users always receive a fresh
code on their next message.

### Required Env Vars

```bash
# Telegram
TELEGRAM_BOT_TOKEN=

# Discord
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=
```

Messaging is a Max-only feature (Explore/Pro are desktop-only).

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

Production runs on EC2 with Docker Compose and nginx:

- public site: `https://yomi.arka6fx.com`
- backend: proxied under `https://yomi.arka6fx.com/api/*`
- nginx terminates TLS using certificates in `deploy/certs`
- GitHub Actions deploys by SSHing to `/opt/yomi`, pulling `main`, and running
  `docker compose up -d --build`

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for the current runbook.

## OAuth

Configure OAuth callbacks:

```text
https://yomi.arka6fx.com/api/auth/callback/github
https://yomi.arka6fx.com/api/auth/callback/google
```

Local callbacks:

```text
http://localhost:3001/api/auth/callback/github
http://localhost:3001/api/auth/callback/google
```

## Speech And Models

| Capability | Provider / default |
| --- | --- |
| Fast LLM | AI Credits/OpenAI-compatible endpoint, `gpt-4.1-mini` |
| Agent LLM | AI Credits/OpenAI-compatible endpoint, `gpt-4.1` |
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
| 16 | [Windows app automation](specs/16-windows-app-automation.md) |
| 17 | [Browser automation](specs/17-browser-automation.md) |
| 18 | [Automation orchestration](specs/18-automation-orchestration.md) |

## Privacy

- No silent recording. The tray/notch UI shows when listening or capturing.
- Password managers and banking apps must be blocklisted from capture.
- Desktop automation is foreground-specific.
- Memory is user-owned and export/delete must remain possible.
- OAuth tokens are encrypted at rest.
