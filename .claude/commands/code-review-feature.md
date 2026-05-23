---
description: Review the current diff for security, quality, and arch invariants
allowed-tools: Bash, Read, Glob, Grep
---

Review all staged and unstaged changes. `$ARGUMENTS` is an optional focus area (e.g. `auth`, `billing`, `sidecar`).

## 1 — Collect diff

```bash
git diff --staged
git diff
```

If both are empty, stop: "No changes to review. Stage or make changes first."

## 2 — Architecture invariants (blockers)

Check the diff against `CLAUDE.md` hard invariants:

1. **Key isolation** — LLM API keys must not appear in `apps/desktop/` or `apps/sidecar/`
2. **Fast-path purity** — the fast path must not add a tool-selection loop or extra LLM calls
3. **Brain placement** — router and ReAct loop belong in `apps/sidecar/`, not `apps/desktop/`
4. **Intent router** — must fire at turn START and never mid-conversation
5. **Privacy** — no silent capture; no password-manager content leaving the device

Report each as **PASS / FAIL / N/A**.

## 3 — Security scan

Check for:
- Hardcoded secrets, tokens, or API keys in source
- Missing auth guards on new routes (`/api/*` without session check)
- SQL injection risk in raw query strings
- `dangerouslySetInnerHTML` without sanitisation
- `shell: true` in `spawn()` calls
- CORS `origin: "*"` on credentialed routes

## 4 — Quality check

- New code follows existing patterns in the same file/package
- No `any` without a comment explaining why
- Error paths handled (no silent swallows)
- Imports don't cross the architecture layers (desktop importing sidecar logic, etc.)

## 5 — Unified report

```
Code Review — <focus or "full diff">

Architecture: PASS | FAIL (list blockers)

Security findings:
  [CRITICAL] <description> — <file>:<line>
  [WARN]     <description> — <file>:<line>

Quality findings:
  [WARN] <description> — <file>:<line>

Verdict: APPROVED | APPROVED WITH SUGGESTIONS | CHANGES REQUESTED
```

Ask: "Should I implement the suggested fixes?"
Wait for explicit yes before editing anything.
