# Yomi

Cross-platform AI buddy that lives on your desktop. Sees your screen, hears your voice, and acts so you touch your laptop less.

**Mac** (menu bar / notch) · **Windows** (system tray) · **Linux/Omarchy** (Waybar)

---

## How it works

Every request is routed to one of two architectures:

| Type | Path | Latency |
|---|---|---|
| Quick ask / screen Q&A | Linear pipeline: STT → screenshot → 1 LLM call → TTS | < 2 s |
| Autonomous task | ReAct agent loop + subagents + MCP tools | seconds–minutes (background) |

The **local sidecar** is the brain. The **Electron shell** is just capture + UI. LLM keys never touch the device.

---

## Monorepo

```
apps/
  backend/    Hono on Bun  — auth, billing, LLM proxy, usage metering
  desktop/    Electron v1  — tray/menubar, hotkeys, screen+mic capture, floating UI
  landing/    Next.js 14   — marketing site + waitlist (Vercel)
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
# No Claude subscription? Use OpenRouter instead:
OPENROUTER_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1

# ElevenLabs for STT + TTS
ELEVENLABS_API_KEY=...

# Database (Neon free tier works)
DATABASE_URL=postgres://...
```

The LLM layer uses the **Vercel AI SDK** (`ai` package), so you can swap providers without changing code — OpenRouter, Anthropic, OpenAI, Groq all work.

---

## LLM provider switching

The sidecar uses `@ai-sdk/openai` with a configurable base URL. To switch providers, set env vars — no code changes needed:

```bash
# Anthropic (direct)
ANTHROPIC_API_KEY=sk-ant-...
# unset LLM_BASE_URL

# OpenRouter (test any model, no direct subscription required)
OPENROUTER_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1
FAST_PATH_MODEL=anthropic/claude-haiku-4-5       # or mistralai/mistral-7b-instruct
AGENT_PATH_MODEL=anthropic/claude-sonnet-4-6

# Groq (ultra-fast, free tier available)
GROQ_API_KEY=gsk_...
LLM_BASE_URL=https://api.groq.com/openai/v1
FAST_PATH_MODEL=llama-3.1-8b-instant
```

---

## Speech (ElevenLabs)

Yomi uses **ElevenLabs** for both STT and TTS:

- **STT:** `POST /v1/speech-to-text` — cloud transcription with streaming partial results
- **TTS:** `POST /v1/text-to-speech/:voice_id/stream` — streaming audio starts before full response

Local **whisper.cpp** is the offline fallback when no ElevenLabs key is set.

---

## Tech stack

| Layer | Choice |
|---|---|
| LLM SDK | Vercel AI SDK + `@ai-sdk/anthropic` + `@ai-sdk/openai` (OpenRouter compat) |
| Speech | ElevenLabs STT + TTS (whisper.cpp local fallback) |
| Backend | Hono on Bun |
| Auth | Better Auth |
| DB | Postgres (Neon) + Drizzle ORM |
| Billing | Stripe |
| Desktop | Electron v1 |
| Landing | Next.js 14 (Vercel) |

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

Detailed design docs live in [`specs/`](./specs/):

| # | Doc | Contents |
|---|---|---|
| 0 | [00-overview](specs/00-overview.md) | Principles, moat, glossary |
| 1 | [01-architecture](specs/01-architecture.md) | 4-layer diagram, IPC contracts |
| 2 | [02-sidecar-fast-pipeline](specs/02-sidecar-fast-pipeline.md) | Fast linear pipeline, visual guidance |
| 3 | [03-sidecar-router](specs/03-sidecar-router.md) | Intent router (fast vs agent) |
| 4 | [04-speech-stt](specs/04-speech-stt.md) | STT: ElevenLabs, whisper.cpp, VAD |
| 5 | [05-speech-tts](specs/05-speech-tts.md) | TTS: ElevenLabs, edge-tts, Piper |
| 6 | [06-sidecar-agent](specs/06-sidecar-agent.md) | ReAct loop, tools, subagents, sandbox |
| 7 | [07-harness](specs/07-harness.md) | System prompt, hooks, guards |
| 8 | [08-memory](specs/08-memory.md) | Notepad, compaction, retrieval |
| 9 | [09-backend](specs/09-backend.md) | Hono routes, auth, LLM proxy, metering |
| 10 | [10-database](specs/10-database.md) | Full Drizzle schema |
| 11 | [11-pricing](specs/11-pricing.md) | Plans, Stripe, metering logic |
| 12 | [12-desktop-shell](specs/12-desktop-shell.md) | Electron process, platform adapters, capture |
| 13 | [13-desktop-ui](specs/13-desktop-ui.md) | Floating UI, status pill, guide overlay |

---

## Privacy

- **Local-by-default:** STT and screen analysis run on-device; only the distilled prompt leaves.
- **Visible status:** tray/notch pill always shows when Yomi is listening or capturing.
- **Per-app blocklist:** password managers and banking apps are never captured.
- **Encrypted sync:** memory files encrypted in transit and at rest.
