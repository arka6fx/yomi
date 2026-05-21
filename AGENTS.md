# Yomi — AGENTS.md

## Quick start

```bash
bun install && bun run dev        # install + run all apps in watch
```

| App | Port | Command |
|---|---|---|
| `apps/backend` | :3001 | `cd apps/backend && bun run dev` |
| `apps/sidecar` | :3002 | `cd apps/sidecar && bun run dev` |
| `apps/landing` | :3000 | `cd apps/landing && bun run dev` |
| `apps/desktop` | Electron | `cd apps/desktop && bun run dev` |

## Verify commands (turbo)

```bash
turbo lint         # lint all
turbo typecheck    # typecheck all (depends on build)
turbo build        # build all
turbo test         # run all bun test suites in parallel, cached per-package
```

## Database (Drizzle + Neon)

All DB commands run from `apps/backend/`:

```bash
bun run db:generate   # generate migrations
bun run db:migrate    # run migrations
bun run db:studio     # Drizzle Studio UI
```

Or from `packages/db/` — both have identical scripts.

## Architecture

```
desktop (Electron) ↔ sidecar (Bun, :3002) ↔ backend (Hono, :3001)
packages/shared   ← TypeScript contracts across all three
packages/db       ← Drizzle schema + Neon client
```

- LLM keys live ONLY in backend env — never shipped to desktop/sidecar
- Desktop uses `electron-vite` (not raw electron)
- **Test runner:** `bun test` (Bun built-in, no extra deps needed)
- .env.example has full reference for env vars
- **Comments:** keep small, purposeful comments throughout. One-liners on non-obvious logic, short section headers where useful. No multi-line docstrings.

## Stack (settled — preserve existing choices)

| Concern | Choice |
|---|---|
| LLM SDK | Vercel AI SDK (`ai` package) |
| Backend | Hono on Bun |
| Auth | Better Auth |
| ORM | Drizzle |
| Desktop | Electron + electron-vite |
| Sidecar | Bun + Hono |
| DB | Postgres (Neon serverless) |

## Available skills

Agent skills live in `.agents/skills/` (also mirrored to `.claude/skills/`):
- `ai-sdk` — Vercel AI SDK usage
- `electron` — Electron development
- `frontend-design` — UI/UX components
- `turborepo` — Turbo monorepo config
- `workers-best-practices` — Cloudflare Workers
- `wrangler` — Wrangler CLI

## Available subagents

Subagents are defined in `.opencode/agents/` — invoke them with `@name` in the TUI:
- `@yomi-test-writer` — Write spec-driven `bun test` tests for Yomi features
- `@yomi-test-runner` — Run tests and analyze results
- `@yomi-security-reviewer` — Security review (API keys, IPC auth, privacy)
- `@yomi-quality-reviewer` — Code quality review (TypeScript, Hono, monorepo)

Commands in `.opencode/commands/` orchestrate these subagents (e.g. `/code-review-feature` runs security + quality reviewers in parallel).

## Important CLAUDE.md rules

Read `CLAUDE.md` at root — it contains detailed intent routing, harness, notepad, privacy, model choices, and pricing. Preserve its guidance when editing.

Key non-obvious conventions:
- **Intent router** decides fast vs agent path at START of every turn. Never switch mid-turn.
- **Models (2026-05):** Fast path `claude-haiku-4-5-20251001`, Agent path `claude-sonnet-4-6`
- **Prompt caching** always enabled for Anthropic SDK
- **Privacy:** STT + screen analysis on-device; only distilled prompt leaves. Tray pill always shows capture state. Per-app blocklist for password managers/banking.

## Specs

Detailed design docs live in `specs/`, numbered in implementation order. Read the relevant spec before modifying a subsystem.

| Spec | Contents |
|---|---|
| [00-overview](specs/00-overview.md) | Principles, moat, glossary — reference |
| [01-architecture](specs/01-architecture.md) | 4-layer diagram, IPC contracts — reference |
| [02-sidecar-fast-pipeline](specs/02-sidecar-fast-pipeline.md) | Fast pipeline, Anthropic + caching, visual guidance ← current |
| [03-desktop-shell](specs/03-desktop-shell.md) | Electron main process, sidecar lifecycle, IPC bridge, hotkey |
| [04-desktop-ui](specs/04-desktop-ui.md) | Floating overlay, Zustand store, audio capture |
| [05-speech-stt](specs/05-speech-stt.md) | STT: ElevenLabs, whisper.cpp, VAD |
| [06-speech-tts](specs/06-speech-tts.md) | TTS: ElevenLabs, edge-tts, Piper |
| [07-sidecar-router](specs/07-sidecar-router.md) | Intent router (fast vs agent) |
| [08-sidecar-agent](specs/08-sidecar-agent.md) | ReAct loop, tools, subagents, sandbox |
| [09-harness](specs/09-harness.md) | System prompt, hooks, guards |
| [10-memory](specs/10-memory.md) | Notepad (~/.yomi/), compaction, retrieval |
| [11-database](specs/11-database.md) | Drizzle schema + Neon |
| [12-backend](specs/12-backend.md) | Hono routes, Better Auth, LLM proxy, metering |
| [13-pricing](specs/13-pricing.md) | Plans, Stripe, metering |
