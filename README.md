# Yomi

AI buddy that lives on your desktop. Sees your screen, hears your voice, and acts so you touch your laptop less.

**Mac** (menu bar / notch) · **Windows** (system tray)

---

## How it works

Every request is routed to one of two pipelines:

| Type | Path | Latency |
|---|---|---|
| Quick ask / screen Q&A | Linear pipeline: STT → screenshot → 1 LLM call → TTS | < 2 s |
| Autonomous task | ReAct agent loop + subagents + MCP tools | seconds–minutes (background) |

The **local sidecar** is the brain. The **Electron shell** is just capture + UI. LLM keys live only in the cloud backend, never on-device.

---

## Monorepo

```
apps/
  backend/    Hono on Bun  — auth, billing (Razorpay), LLM proxy, usage metering
  desktop/    Electron v1  — tray/menubar, hotkeys, screen+mic capture, floating UI
  landing/    Next.js 16   — marketing site + waitlist (Vercel)
  sidecar/    Bun service  — intent router, fast pipeline, ReAct loop, notepad memory
packages/
  db/         Drizzle schema + Neon client
  shared/     TypeScript contracts across all apps
  config/     Shared tsconfig + eslint presets
```

---

## Quick start

**Prerequisites:** [Bun ≥ 1.1](https://bun.sh/), Node ≥ 20

```bash
git clone https://github.com/your-username/yomi
cd yomi
bun install
cp .env.example .env   # fill in keys
bun run dev            # runs all apps in watch mode
```

Individual apps run on:

| App | Port / target |
|---|---|
| `apps/landing` | http://localhost:3000 |
| `apps/backend` | http://localhost:3001 |
| `apps/sidecar` | http://localhost:3002 |
| `apps/desktop` | Electron window |

---

## Environment setup

Copy `.env.example` → `.env`. Minimum keys to start:

```bash
# OpenAI (all AI routing uses OpenAI models)
OPENAI_API_KEY=sk-...

# Database (Neon free tier works)
DATABASE_URL=postgres://...

# Razorpay (billing)
RAZORPAY_KEY_ID=rzp_...
RAZORPAY_KEY_SECRET=...
```

All AI routing — chat, reasoning, STT, TTS, image understanding — runs through OpenAI models via the Vercel AI SDK. No other providers are used.

---

## Plans

| Plan | Price | Highlights |
|---|---|---|
| Free | $0 | Fast AI chat, basic memory, voice input, standard AI usage |
| Basic | $4/mo | + Screenshot understanding, standard response priority |
| Standard | $9/mo | + Faster responses, better memory, priority AI access, enhanced personalization |
| Genesis | $19/mo | Advanced reasoning mode, premium voice, long-context, experimental features |

Billing is handled by **Razorpay** (UPI, cards, international payments). Subscription management flows through webhook-verified payments.

---

## AI model routing

All requests are sent to OpenAI models by default:

| Task | Model |
|---|---|
| Normal chat / assistant | `gpt-4.1-mini` |
| Advanced reasoning | `gpt-4.1` |
| Speech-to-text | `whisper-1` |
| Voice output (TTS) | `gpt-4o-mini-tts` |
| Image understanding | `gpt-4.1-mini` |
| Image generation | `gpt-image-1` |

Override via env vars: `FAST_PATH_MODEL`, `AGENT_PATH_MODEL`, `STT_MODEL`, `TTS_MODEL`.

---

## Speech

**STT** uses OpenAI Whisper (`whisper-1`) via the sidecar (`POST /stt`). No local fallback — requires `OPENAI_API_KEY`.

**TTS** uses OpenAI (`gpt-4o-mini-tts`) with the Alloy voice. Configurable via `TTS_MODEL` and `TTS_ENGINE` env vars.

---

## Tech stack

| Layer | Choice |
|---|---|
| LLM SDK | Vercel AI SDK + `@ai-sdk/openai` |
| Speech | OpenAI Whisper (STT) + OpenAI TTS |
| Backend | Hono on Bun |
| Auth | Better Auth — Google OAuth, GitHub OAuth |
| DB | Postgres (Neon) + Drizzle ORM |
| Billing | Razorpay |
| Desktop | Electron v1 |
| Landing | Next.js 16 (Vercel) |

---

## Build commands

```bash
bun run build      # turbo build — all apps
bun run typecheck  # turbo typecheck
bun run lint       # turbo lint

# Database
cd apps/backend && bun run db:generate   # generate migrations
cd apps/backend && bun run db:migrate    # run migrations
cd apps/backend && bun run db:studio     # Drizzle Studio UI
```

---

## Specs

Detailed design docs live in [`specs/`](./specs/), ordered by implementation sequence:

| # | Doc | Contents |
|---|---|---|
| 00 | [00-overview](specs/00-overview.md) | Principles, identity, invariants, phase map |
| 01 | [01-architecture](specs/01-architecture.md) | Four-layer architecture, IPC contracts, data flows |
| 02 | [02-sidecar-fast-pipeline](specs/02-sidecar-fast-pipeline.md) | Fast linear pipeline, Anthropic + caching, visual guidance |
| 03 | [03-desktop-shell](specs/03-desktop-shell.md) | Electron main process, platform adapters, sidecar lifecycle, capture abstraction |
| 04 | [04-desktop-ui](specs/04-desktop-ui.md) | Floating buddy window, status pill, settings, guide overlay |
| 05 | [05-speech-stt](specs/05-speech-stt.md) | STT: ElevenLabs + whisper.cpp with streaming partials |
| 06 | [06-speech-tts](specs/06-speech-tts.md) | TTS: ElevenLabs, edge-tts, Piper (three tiers) |
| 07 | [07-sidecar-router](specs/07-sidecar-router.md) | Intent router classifying fast vs agent per turn |
| 08 | [08-sidecar-agent](specs/08-sidecar-agent.md) | ReAct loop, tools, subagents, sandboxed bash |
| 09 | [09-harness](specs/09-harness.md) | System prompt, tool schemas, state machine, hooks, guards |
| 10 | [10-memory](specs/10-memory.md) | Filesystem notepad (~/.yomi/), compaction, retrieval |
| 11 | [11-database](specs/11-database.md) | Drizzle schema, migrations, indexes, encryption |
| 12 | [12-backend](specs/12-backend.md) | Hono routes, Better Auth, LLM proxy, metering, Stripe |
| 13 | [13-pricing](specs/13-pricing.md) | Plans, Stripe integration, metering, cap enforcement |
| 14 | [14-landing-page](specs/14-landing-page.md) | Marketing site + conversion funnel (Next.js 16, Vercel) |
| 15 | [15-deploy](specs/15-deploy.md) | Backend → Cloudflare Workers, landing → Cloudflare Pages |

---

## Privacy

- **Local-by-default:** screen analysis runs on-device; only the distilled prompt leaves.
- **Visible status:** tray/notch pill always shows when Yomi is listening or capturing.
- **Per-app blocklist:** password managers and banking apps are never captured.
- **Encrypted sync:** memory files encrypted in transit and at rest.
