---
description: Run every check CI runs, and fix what fails
---

Run the repository's checks from the repo root and report the results:

1. `npm run python:lint`
2. `npm run python:test`
3. `npm run format:check`
4. `npm run lint`
5. `npm run typecheck`
6. `npm run test`
7. `npm run docs:check`

Run independent checks in parallel where possible. For each failure, find the
root cause and fix it if it's caused by the current changes (`git diff` against
`origin/main`), then re-run that check. If a failure is also present on
`origin/main`, say so and don't fix it here.

Finish with one line per check: pass, fixed, or failing (with the reason).
$ARGUMENTS
