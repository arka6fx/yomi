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

| Doc | Contents |
|---|---|
| [00-overview](specs/00-overview.md) | Principles, moat, glossary |
| [01-architecture](specs/01-architecture.md) | 4-layer diagram, IPC contracts |
| [02-sidecar](specs/02-sidecar.md) | Router, fast pipeline, ReAct loop |
| [03-harness](specs/03-harness.md) | System prompt, tools, hooks, guards |
| [04-memory](specs/04-memory.md) | Notepad system, compaction, retrieval |
| [05-desktop](specs/05-desktop.md) | Electron, platform adapters, capture |
| [06-backend](specs/06-backend.md) | Hono routes, auth, LLM proxy, metering |
| [07-database](specs/07-database.md) | Full Drizzle schema |
| [08-speech](specs/08-speech.md) | ElevenLabs, whisper.cpp, latency budget |
| [09-pricing](specs/09-pricing.md) | Plans, Stripe, metering logic |

---

## Phase roadmap

| Phase | Scope |
|---|---|
| **0 — Spike** | hotkey → ElevenLabs STT → screenshot → 1 LLM call → ElevenLabs TTS |
| **1 — Buddy** | floating UI, tray/menubar, notepad, prompt caching, permissions |
| **2 — Agent** | router, ReAct loop, hooks, MCP connectors, subagents |
| **3 — Accounts** | auth, Stripe billing, LLM proxy, cloud sync |
| **4 — X-platform** | Windows, Linux/Omarchy |
| **5 — Launch** | landing, pricing, Discord |

---

## Privacy

- **Local-by-default:** STT and screen analysis run on-device; only the distilled prompt leaves.
- **Visible status:** tray/notch pill always shows when Yomi is listening or capturing.
- **Per-app blocklist:** password managers and banking apps are never captured.
- **Encrypted sync:** memory files encrypted in transit and at rest.
