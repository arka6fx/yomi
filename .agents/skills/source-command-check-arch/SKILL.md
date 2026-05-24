---
name: "source-command-check-arch"
description: "Check current diff against Yomi architecture invariants"
---

# source-command-check-arch

Use this skill when the user asks to run the migrated source command `check-arch`.

## Command Template

Audit the current git diff against Yomi's hard architecture invariants.

## 1 — Collect diff

```bash
git diff --staged
git diff
```

Also read `AGENTS.md` invariants section.

## 2 — Hard invariants (any failure is a blocker)

Check each against the diff:

| # | Rule | What to look for in diff |
|---|---|---|
| 1 | **Key isolation** — LLM API keys only in `apps/backend/` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` in `apps/desktop/` or `apps/sidecar/` |
| 2 | **Fast-path purity** — STT → screenshot → 1 LLM call → TTS, no loop | extra `generateText` calls, tool-selection logic added to fast path |
| 3 | **Brain in sidecar** — router and agent loop live in `apps/sidecar/`, not `apps/desktop/` | LLM calls or ReAct code in `apps/desktop/src/` |
| 4 | **Intent router fires once at turn start** | model switching mid-turn, router called inside a loop |
| 5 | **Privacy** — no silent screen/mic capture; password managers never captured | `setContentProtection(false)`, capture code without tray indicator |

## 3 — Soft checks (flag, not block)

- New dependency added to wrong app (e.g. `hono` added to desktop)
- New tool added without deciding fast-path vs agent-path placement
- New tokens injected before the prompt-cache boundary

## 4 — Report

```
Architecture Audit

Hard invariants:
  1. Key isolation    — PASS / FAIL: <detail>
  2. Fast-path purity — PASS / FAIL: <detail>
  3. Brain in sidecar — PASS / FAIL: <detail>
  4. Router once      — PASS / FAIL: <detail>
  5. Privacy          — PASS / FAIL: <detail>

Soft checks:
  <any warnings>

Verdict: CLEAN | BLOCKERS FOUND
```

If blockers are found, list the exact file and line. Do not suggest fixes until the user asks.
