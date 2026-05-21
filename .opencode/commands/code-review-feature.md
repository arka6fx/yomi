---
description: Run parallel security + quality code review on changed code
---
Run the full code review pipeline for the feature specified in $ARGUMENTS.

If no argument is provided, stop and say:
"Please provide a spec name. Usage: /code-review-feature <name> e.g. /code-review-feature sidecar-fast-pipeline"

## Pre-flight Check

Collect the diff:
- Run `git diff` for unstaged changes
- Run `git diff --staged` for staged changes
- Combine both into a single diff

If both are empty, stop and say: "No changes detected. Implement the feature before running code review."

If the spec file at `specs/$ARGUMENTS.md` does not exist, stop and say: "Spec file not found at specs/$ARGUMENTS.md."

---

## Step 1: Parallel Review

Invoke **yomi-security-reviewer** and **yomi-quality-reviewer** simultaneously with:
- The combined diff
- The spec file at `specs/$ARGUMENTS.md`
- Source files: relevant files in `apps/` and `packages/` touched by the diff

Both must run in parallel. Do not wait for one before starting the other.

---

## Step 2: Unified Report

Combine findings into a single report:

```
Code Review Report — $ARGUMENTS

## Security Findings
[from yomi-security-reviewer]

## Quality Findings  
[from yomi-quality-reviewer]

## Combined Action Plan
Ordered checklist by severity (security critical first, quality improvements last)

## Verdict
APPROVED | APPROVED WITH SUGGESTIONS | CHANGES REQUESTED
```

---

## Step 3: Ask for Approval

After presenting the report, ask: "Do you want me to implement the action plan now?"

Wait for explicit user confirmation before making any changes. Do not edit files until approved.

---

## Rules
- Do NOT edit files before user approval
- Do NOT start one reviewer before the other — both in parallel
- Do NOT skip the pre-flight diff check
- If either subagent fails, report it — do not present a partial review as complete
