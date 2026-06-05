# Spec 00 — Overview

## Purpose

Single source of truth for Yomi's identity, principles, and phase map. Every
other spec links back here for context.

## Invariants

- Every request is routed to either the fast path OR the agent path — never
  both, never mid-turn switching.
- The desktop shell has no AI logic. It is capture + UI only.
- LLM keys live in the cloud backend only.
- The local memory engine (`~/.yomi/`) is the user's persistent personal memory.
  It is filesystem-first and is not synced to Neon by default.
- Cloud RAG mirrors larger non-personal Yomi memory artifacts such as old
  sessions, project notes, scratchpads, long memory files, and historical
  decisions; local archive fallback remains available when needed.

## Detailed Design

### What is Yomi

Cross-platform AI buddy (Mac menu bar/notch, Windows tray) that routes requests
between a fast linear pipeline and a foreground ReAct agent loop. The
differentiating insight: fast responses and autonomous tasks have opposite
latency budgets, so they need different architectures — but users want both.

### Moat

| Advantage            | Detail                                                              |
| -------------------- | ------------------------------------------------------------------- |
| Cross-platform       | Mac menu bar/notch + Windows tray                                   |
| Dual architecture    | Router chooses fast linear pipeline OR ReAct agent loop per request |
| Persistent memory    | Local memory engine (`~/.yomi/`) - survives reboots, agent-curated  |
| Cloud archive mirror | Backend search over mirrored non-personal Yomi memory files         |
| Foreground agent     | Autonomous tasks with ReAct loop + subagents                        |
| MCP ecosystem        | Calendar, email, browser (Playwright), Notion, Slack                 |
| Act mode             | Opt-in desktop automation via UIA for Windows native apps           |
| AutomationGraph      | LangGraph-based orchestration with validation, recovery, and learning|

### Glossary

| Term                  | Meaning                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Sidecar**           | Local Bun process that ships with the desktop app. The brain.                                                 |
| **Shell**             | The Electron app. Capture + UI + OS integration only.                                                         |
| **Fast path**         | Linear pipeline: STT → screenshot → 1 LLM call → TTS                                                          |
| **Agent path**        | ReAct loop with tools, MCP servers, subagents, and LangGraph orchestration                                    |
| **Intent router**     | First step of every turn. Returns `fast` or `agent`.                                                          |
| **Local memory**      | `~/.yomi/` filesystem memory plus local indexes/profiles. Not cloud-synced by default.                        |
| **Cloud RAG**         | Pro/Max-only mirrored retrieval over Yomi-generated archive context, with local fallback when offline.        |
| **Harness**           | System prompt + tools + memory + code execution + hooks                                                       |
| **Compaction**        | Recall pass + precision pass → reset context window                                                           |
| **Act mode**          | Opt-in state where Yomi can perform desktop actions (click, type, toggle) via UIA                             |
| **MCP client**        | Generic stdio-based client in sidecar for connecting Playwright, filesystem, and other MCP servers            |
| **AutomationGraph**   | LangGraph state machine wrapping the ReAct loop with planning, validation, recovery, and learning             |
| **Knowledge Base**    | `~/.yomi/knowledge.db` — persistent store of automation results, patterns, and corrections for agent learning |

### Phase Map

_Phases 0–4 are complete. Phase 5 is in progress._

| Phase          | Scope                                                                                               | Status     |
| -------------- | --------------------------------------------------------------------------------------------------- | ---------- |
| 0 — Spike      | hotkey → ElevenLabs STT → screenshot → 1 LLM call → ElevenLabs TTS                                  | Done       |
| 1 — Buddy      | tray/notch status, Mission Control, notepad init, permissions                                       | Done       |
| 2 — Agent      | intent router, ReAct loop, hooks lifecycle, MCP (calendar, email, browser), subagents               | Done       |
| 3 — Accounts   | Hono backend, Better Auth, Drizzle/Neon, Razorpay, LLM proxy (Vercel AI SDK)                        | Done       |
| 4 — Automation | Windows UIA helper (C#/FlaUI), browser MCP (Playwright), Act mode, safety guard, automation DB      | Done       |
| 5 — Orchestrate| LangGraph AutomationGraph, provider-routed sub-agents, knowledge base, Mission Control streaming     | In progress|
| 6 — Launch     | Next.js landing, waitlist → download, pricing page, Discord                                         | Pending    |

## Files to change

None — this is a reference document, not implementation.

## Files to create

None — overview is kept in a single file.

## Resolved Questions

- **Tauri port:** deferred. Electron continues as the primary desktop shell.
  App automation needs UIA (Windows) / Accessibility API (macOS), not a framework
  switch.
- **Proactive hooks:** parked. Current focus is on foreground Act mode and
  user-initiated automation, not proactive triggers.
