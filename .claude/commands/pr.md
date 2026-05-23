---
description: Open a GitHub pull request for the current branch via gh CLI
allowed-tools: Bash
---

Create a pull request for the current branch into `main`. `$ARGUMENTS` is an optional PR title override.

## 1 — Verify branch

```bash
git branch --show-current
git log main..HEAD --oneline
git diff main...HEAD --stat
```

If already on `main`, stop and say "Create a feature branch first."
If there are no commits ahead of main, stop and say "Nothing to open a PR for."

## 2 — Ensure pushed

```bash
git push -u origin HEAD
```

## 3 — Draft title and body

If `$ARGUMENTS` is set, use it as the PR title.
Otherwise derive the title from `git log main..HEAD --oneline` (first line, remove commit hash prefix).

Body format:
```
## What
<1–3 bullet summary of the change>

## Why
<motivation — what problem does this solve>

## Test plan
- [ ] <how to verify the happy path>
- [ ] <edge case if applicable>
```

## 4 — Create PR

```bash
gh pr create --base main --title "<title>" --body "<body>"
```

Print the PR URL when done.

## Rules
- Never target a branch other than `main` unless the user specifies
- Do not merge — creation only
