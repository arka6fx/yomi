---
description: Commit staged changes and push — /ship-feature "feat: my message"
allowed-tools: Bash
---

Commit and push the current working tree. `$ARGUMENTS` is the commit message body (optional — auto-generate from diff if omitted).

## 1 — Sanity check

```bash
git status
git diff --staged
git diff
```

If everything is clean with no staged or unstaged changes, stop and say "Nothing to commit."

## 2 — Stage all tracked changes

```bash
git add -u
```

Do **not** use `git add .` — untracked files (secrets, generated assets) must be added explicitly by the user.

## 3 — Generate or use commit message

If `$ARGUMENTS` is non-empty, use it verbatim as the commit message subject.

If `$ARGUMENTS` is empty, read `git diff --staged` and write a Conventional Commit subject line:
- `feat:` new capability  
- `fix:` bug fix  
- `chore:` config / tooling  
- `refactor:` internal restructure  
- `docs:` documentation  
Under 72 chars, imperative mood, no trailing period.

## 4 — Commit

```bash
git commit -m "<subject>"
```

If the pre-commit hook fails, report the error — do not use `--no-verify`.

## 5 — Push

```bash
git push
```

If the branch has no upstream, run `git push -u origin HEAD`.

## 6 — Summary

```
✓ Committed — <message>
✓ Pushed    — <branch> → origin

Next: /pr to open a pull request, or keep working.
```
