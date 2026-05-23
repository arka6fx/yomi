---
description: Run bun test for an app or file — /test-feature backend or /test-feature sidecar/route
allowed-tools: Bash, Read, Glob
---

Run the test suite for `$ARGUMENTS`. Scope can be an app name, a file glob, or empty for all.

## 1 — Resolve scope

| `$ARGUMENTS` | Command |
|---|---|
| empty | `cd <root> && bun test` (all workspaces) |
| `backend` | `cd apps/backend && bun test` |
| `sidecar` | `cd apps/sidecar && bun test` |
| `desktop` | `cd apps/desktop && bun test` |
| `db` | `cd packages/db && bun test` |
| `shared` | `cd packages/shared && bun test` |
| a file path | `bun test <path>` |

If no test files exist in the target scope, report: "No test files found in <scope>. Create a `*.test.ts` file next to the source file you want to test."

## 2 — Run

```bash
bun test [scope]
```

Capture stdout and stderr. Note the pass/fail counts.

## 3 — On failure

Read each failing test file. Cross-reference with the source file it tests. Report:

```
Test Results — <scope>

✓ <N> passed
✗ <N> failed

Failures:
  <test name> — <file>:<line>
  Expected: <value>
  Received: <value>
  Likely cause: <one line>
```

Do **not** edit source files. Report findings only.

## 4 — On pass

```
✓ All <N> tests passed in <scope>
```
