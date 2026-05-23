---
description: Run lint + typecheck + format check across the monorepo (or one app)
---

Run the full static analysis suite. `$ARGUMENTS` can be an app name to scope the run (e.g. `backend`, `sidecar`, `desktop`, `landing`).

## 1 — Determine scope

If `$ARGUMENTS` is empty, run workspace-wide:

```bash
bun run lint && bun run typecheck && bun run format:check
```

If `$ARGUMENTS` is one of `backend | sidecar | desktop | landing | db | shared`:

```bash
cd apps/$ARGUMENTS   # or packages/$ARGUMENTS for db/shared
bun run lint
bun run typecheck
bun run format:check
```

## 2 — Report

For each check output one of:

```
✓ lint       — no issues
✓ typecheck  — no errors
✓ format     — all files formatted

✗ lint       — <N> problems (list first 5)
✗ typecheck  — <N> errors (list first 5)
✗ format     — <N> files need formatting (list them)
```

## 3 — Fix prompt

If any check failed, ask: "Fix lint and format issues automatically? (typecheck errors require manual fixes)"

On yes:
```bash
bun run format          # auto-fix formatting
eslint --fix src        # from the relevant app dir
```

Re-run checks after fixing to confirm clean.
