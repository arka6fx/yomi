# Yomi — CLAUDE.md

Cross-platform AI buddy. Sees your screen, hears your voice, acts so you touch your laptop less. Mac (menu bar / notch), Windows (system tray), Linux/Omarchy (Waybar).

---

## Design principle

| Request type | Architecture | Budget |
|---|---|---|
| Quick ask / screen Q&A | Linear pipeline | < 2 s |
| Screen-aware guidance | Linear pipeline + vision | < 3 s |
| Autonomous task | ReAct loop + subagents | seconds–minutes, background |

**Intent router** decides fast vs agent at the START of every turn. Never route mid-turn — switching models loses the prompt cache and causes tool-vocab mismatch.

---

## Monorepo

```
apps/backend/   Hono/Bun — auth, billing, LLM proxy, metering
apps/desktop/   Electron — tray/menubar, hotkeys, capture, floating UI
apps/landing/   Next.js  — marketing + waitlist (Vercel)
apps/sidecar/   Bun      — router, fast pipeline, agent loop, notepad
packages/db/    Drizzle schema + Neon
packages/shared TypeScript contracts (desktop ↔ sidecar ↔ backend)
packages/config tsconfig + eslint presets
```

```bash
bun install && bun run dev        # install + run all in watch mode
cd apps/backend  && bun run dev   # :3001
cd apps/sidecar  && bun run dev   # :3002
cd apps/landing  && bun run dev   # :3000
cd apps/desktop  && bun run dev   # Electron
```

---

## Stack (settled — do not relitigate)

| Layer | Choice |
|---|---|
| Landing | Next.js 14 / Vercel |
| Backend | Hono on Bun |
| Database | Postgres — Neon (serverless) |
| ORM | Drizzle |
| Auth | Better Auth (Drizzle adapter, orgs plugin for Team tier) |
| Billing | Stripe |
| LLM SDK | Vercel AI SDK (`ai` package) — unified interface for Anthropic, OpenAI, Groq, OpenRouter |
| Speech STT | ElevenLabs STT (cloud); whisper.cpp (local/offline fallback) |
| Speech TTS | ElevenLabs TTS (streaming) |
| Desktop | Electron v1 (Tauri-ready — brain stays in sidecar) |
| Sidecar | Bun service (ships with desktop app) |
| Packages | Bun workspaces + Turborepo |

- LLM keys (Anthropic etc.) live ONLY in the cloud backend — never in desktop/sidecar bundle.
- Desktop auth: system-browser OAuth + deep-link back to app. Never embed login in Electron window.
- **OpenRouter:** set `OPENROUTER_API_KEY` + `LLM_BASE_URL=https://openrouter.ai/api/v1` to test with any model before you have a direct provider subscription. The Vercel AI SDK uses `@ai-sdk/openai` with a custom base URL for OpenRouter.

---

## Architecture

```
DESKTOP SHELL  (apps/desktop — Electron)
  tray/menubar/Waybar · global hotkey · push-to-talk
  screen + mic capture · floating UI · deep-link auth
  ↕  local socket  (low-latency authenticated IPC)
LOCAL SIDECAR  (apps/sidecar — Bun)
  intent router · fast pipeline (STT → vision → LLM → TTS)
  ReAct agent loop · MCP + subagents · notepad memory · whisper.cpp
  ↕  authenticated HTTPS
CLOUD BACKEND  (apps/backend — Hono/Bun)
  Better Auth · Stripe webhooks · LLM proxy · usage metering · memory sync
```

---

## Harness (where 80% of engineering effort goes)

`harness = system prompt + tools/MCP + memory + code execution + hooks`

**Fast path:** `STT → speculative screenshot → 1 LLM call (cached system prompt + yomi.md) → TTS`
Tools: `look_at_screen`, `transcribe`, `speak`. No tool-selection loop.

**Agent path:** filesystem r/w · bash (sandboxed) · web search/fetch · cursor automation · MCP servers (calendar, email, Notion, Slack, browser).

**Session lifecycle:**
```
SessionStart → UserPromptSubmit
  → [per-tool] PreToolUse → Tool → PostToolUse → (loop or next)
  → Stop → SessionEnd
```

**Hooks:** `PreToolUse` (block dangerous calls) · `PostToolUse` (log, trim >N tokens) · `Stop` (flush scratchpad) · `SessionEnd` (compact memory.md)

**Loop guards:** cap ReAct iterations · trim tool output middle if >N tokens · progress check every few steps · never switch models mid-turn

---

## Notepad (`~/.yomi/`)

```
yomi.md          ALWAYS preloaded — user identity, prefs, standing instructions
memory.md        Long-term memory (curated, compacted)
memory-index.md  One-line manifest per memory file
projects/<proj>/
  context.md     Project facts + decisions
  scratchpad.md  Agent working notes (ephemeral)
sessions/
  YYYY-MM-DD-topic.md  Session summaries
```

**Load:** always preload `yomi.md`; JIT-load everything else on demand; metadata-only by default.
**Compact:** recall pass → precision pass → write to `memory.md`, reset live window.
**Retrieve:** agent reads index → `list_files` → `read_file` → `search` (ripgrep). No vector DB needed at single-user scale.

---

## Database

Better Auth generates `user / session / account / verification`. App tables:

```
devices        id, user_id, os, app_version, last_seen
subscriptions  id, user_id, stripe_customer_id, stripe_sub_id,
               plan, status, current_period_end
usage_events   id, user_id, device_id, kind(stt|fast_query|agent_run|tts),
               model, input_tokens, output_tokens, cost_cents, created_at
memory_blobs   id, user_id, path, content_hash, updated_at
agent_runs     id, user_id, status, task, started_at, ended_at, summary
mcp_connections id, user_id, provider, oauth_tokens(encrypted), scopes
hook_logs      id, user_id, run_id, hook, tool, decision, payload_redacted, created_at
```

`usage_events` append-only · `oauth_tokens` encrypted at rest · PII redacted in `hook_logs`.

---

## Plans

| Plan | Price | Key limits |
|---|---|---|
| Free | $0 | Local STT; ~50 fast queries/day; 1 agent run/day; BYOK |
| Pro | ~$20/mo | Cloud STT+TTS; fair-use fast path; ~100 agent runs/mo; MCP; cloud sync |
| Max | ~$50/mo | High agent-run cap; cloud subagents; priority latency |
| Team | ~$30/user/mo | Pro + SSO, admin console, shared connectors |

---

## Phases

| Phase | Scope | Wks |
|---|---|---|
| 0 — Spike | hotkey → Whisper → screenshot → 1 LLM call → TTS. No accounts. | 1–2 |
| 1 — Buddy | floating UI · tray/menubar · notepad · prompt caching · permissions | 3–6 |
| 2 — Agent | router · ReAct loop · hooks · MCP (calendar, email, browser) · subagents | 7–12 |
| 3 — Accounts | Hono · Better Auth · Drizzle/Neon · Stripe · Vercel AI SDK proxy · cloud sync | 13–15 |
| 4 — X-platform | Windows tray · Omarchy Waybar · Electron vs Tauri decision | 16–20 |
| 5 — Launch | Next.js landing · waitlist → download · pricing · Discord | 21–22 |

---

## Privacy (non-negotiable)

- Local-by-default: STT + screen analysis on-device; only the distilled prompt leaves the machine.
- Visible status: tray/notch pill always shows when Yomi is listening or capturing. No silent recording.
- Per-app blocklist: password managers and banking apps are never captured.
- Window content-protection: Yomi's own window excluded from screen-shares.
- Encrypted memory sync; user-owned export/delete; clear data-retention policy.

---

## Models (2026-05)

```
Fast path:  claude-haiku-4-5-20251001
Agent path: claude-sonnet-4-6
Heavy:      claude-opus-4-7
```

Always enable Anthropic SDK prompt caching. Cache system prompt + `yomi.md` across turns to minimise cost.
