# Yomi

AI buddy that lives on your desktop. Sees your screen, hears your voice, and acts so you touch your laptop less.

**Mac** (menu bar / notch) · **Windows** (system tray)

---

## How it works

Every request is routed to one of two pipelines:

| Type | Path | Latency |
|---|---|---|
| Quick ask / screen Q&A | STT → screenshot → 1 LLM call → TTS | < 2 s |
| Autonomous task | ReAct agent loop + subagents + MCP tools | seconds–minutes (background) |

The **local sidecar** (Bun) is the brain. The **Electron shell** is capture + UI only. LLM keys live in the cloud backend, never bundled in the desktop app.

---

## Monorepo

```
apps/
  backend/    Hono on Bun  — auth, billing (Razorpay), LLM proxy, usage metering
  desktop/    Electron     — tray, hotkeys, screen+mic capture, floating overlay UI
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

In dev mode, start the sidecar separately before the desktop app:

```bash
# Terminal 1
cd apps/sidecar && bun run dev   # :3002

# Terminal 2
cd apps/desktop && bun run dev   # Electron window
```

| App | Port / target |
|---|---|
| `apps/landing` | http://localhost:3000 |
| `apps/backend` | http://localhost:3001 |
| `apps/sidecar` | http://localhost:3002 |
| `apps/desktop` | Electron window |

---

## Environment setup

Copy `.env.example` → `.env`. Minimum keys to get voice + AI working:

```bash
# LLM — chat, vision, agent (OpenAI or compatible proxy)
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # or your proxy

# STT — Groq Whisper (free tier) recommended; falls back to OPENAI_API_KEY
STT_API_KEY=gsk_...
STT_BASE_URL=https://api.groq.com/openai/v1
STT_MODEL=whisper-large-v3-turbo

# TTS — optional; set TTS_ENGINE=none to disable voice output
TTS_ENGINE=none   # or: openai (requires TTS_API_KEY pointing to real OpenAI)

# Database (Neon free tier works)
DATABASE_URL=postgres://...
```

> **Note:** `OPENAI_BASE_URL` is for LLM chat only. STT and TTS use separate
> `STT_BASE_URL` / `TTS_BASE_URL` vars so they can hit a different endpoint
> (e.g. Groq for STT, real OpenAI for TTS, while LLM goes through a proxy).

---

## Overlay keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Start / stop voice recording |
| `Ctrl+Shift+Enter` | Open text input (type instead of talk) |
| `Ctrl+Shift+H` | Show / hide overlay |
| `Ctrl+Shift+Arrow` | Nudge overlay position (smooth) |
| `Esc` | Cancel voice or text input |

**Text input mode:** press `Ctrl+Shift+Enter`, type your question, press `Enter`. If you press `Enter` without typing, Yomi takes a screenshot and comprehends whatever is on screen.

**Copy:** each response card has a **Copy** button. Code blocks have their own per-block copy button.

---

## AI model routing

| Task | Default model | Override env var |
|---|---|---|
| Fast chat / vision | `gpt-4.1-mini` | `FAST_PATH_MODEL` |
| Agent / reasoning | `gpt-4.1` | `AGENT_PATH_MODEL` |
| Speech-to-text | `whisper-large-v3-turbo` (Groq) | `STT_MODEL` |
| Voice output (TTS) | `gpt-4o-mini-tts` | `TTS_MODEL` |

---

## Speech

**STT** is proxied through the sidecar (`POST /stt`). Uses `STT_API_KEY` / `STT_BASE_URL` — defaults to Groq Whisper (free tier, ~7,200 s/day). Falls back to `OPENAI_API_KEY` if no STT key is set.

**TTS** uses `TTS_API_KEY` / `TTS_BASE_URL`. Set `TTS_ENGINE=none` to disable. When disabled, responses still stream as text in the overlay.

---

## Tech stack

| Layer | Choice |
|---|---|
| LLM SDK | Vercel AI SDK + `@ai-sdk/openai` |
| STT | Groq Whisper (`whisper-large-v3-turbo`) via OpenAI-compatible API |
| TTS | OpenAI TTS (optional) |
| Backend | Hono on Bun |
| Auth | Better Auth - Google + GitHub OAuth |
| DB | Postgres (Neon) + Drizzle ORM |
| Billing | Razorpay |
| Desktop | Electron |
| Landing | Next.js 16 (Vercel) |

---

## Authentication

Desktop and web share sessions through Better Auth:

| Flow | How it works |
|---|---|
| **Desktop sign-in** | Device-code flow (RFC 8628). Click sign-in, your browser opens the device page, and if you are already signed in it auto-confirms. The desktop polls for a session token and stores it encrypted via `safeStorage`. |
| **Landing sign-in** | Direct OAuth via Google/GitHub through Better Auth's client SDK. |
| **Cross-device sign-out** | Signing out from the landing page calls `POST /api/auth/sign-out-all` which revokes all sessions for the user. The desktop detects the invalidated token within 30 seconds and shows the sign-in page. |
| **Session validation** | Desktop checks token validity every 30 seconds against the billing endpoint. A 401 response triggers automatic sign-out. |

Desktop tokens are stored encrypted at:
- **macOS:** `~/Library/Application Support/Yomi/session.enc`
- **Windows:** `%APPDATA%/Yomi/session.enc`

No secrets leave the encrypted storage - not even the app reads the raw token except to attach it as a Bearer header.

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

Design docs in [`specs/`](./specs/), ordered by implementation:

| # | Doc | Contents |
|---|---|---|
| 00 | [00-overview](specs/00-overview.md) | Principles, identity, invariants, phase map |
| 01 | [01-architecture](specs/01-architecture.md) | Four-layer architecture, IPC contracts, data flows |
| 02 | [02-sidecar-fast-pipeline](specs/02-sidecar-fast-pipeline.md) | Fast linear pipeline, prompt caching, visual guidance |
| 03 | [03-desktop-shell](specs/03-desktop-shell.md) | Electron main: sidecar spawn, hotkeys, capture, IPC |
| 04 | [04-desktop-ui](specs/04-desktop-ui.md) | Floating overlay, Zustand store, audio, streaming UI |
| 05 | [05-speech-stt](specs/05-speech-stt.md) | STT abstraction: Groq Whisper + whisper.cpp fallback |
| 06 | [06-speech-tts](specs/06-speech-tts.md) | TTS abstraction: OpenAI TTS streaming |
| 07 | [07-sidecar-router](specs/07-sidecar-router.md) | Intent router: fast vs agent classification |
| 08 | [08-sidecar-agent](specs/08-sidecar-agent.md) | ReAct loop, tools, MCP, subagents, sandbox |
| 09 | [09-harness](specs/09-harness.md) | System prompt, hooks, loop guards |
| 10 | [10-memory](specs/10-memory.md) | Notepad (~/.yomi/), compaction, retrieval |
| 11 | [11-database](specs/11-database.md) | Drizzle schema, Neon, encryption |
| 12 | [12-backend](specs/12-backend.md) | Hono routes, Better Auth, LLM proxy, metering |
| 13 | [13-pricing](specs/13-pricing.md) | Plans, Razorpay, metering, cap enforcement |
| 14 | [14-landing-page](specs/14-landing-page.md) | Marketing site (Next.js 16, Vercel) |
| 15 | [15-deploy](specs/15-deploy.md) | Deploy spec — Cloudflare Workers + Pages |

---

## Privacy

- **Local-by-default:** screen analysis and STT run locally / on-device where possible; only the distilled prompt leaves.
- **Visible status:** overlay always shows when Yomi is listening or capturing.
- **Per-app blocklist:** password managers and banking apps are never captured.
- **Encrypted sync:** memory files encrypted in transit and at rest.
- **Content protection:** overlay window is excluded from screen recordings and video calls.
