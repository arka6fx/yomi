Commit, push, create PR, merge, and clean up after a feature is complete.

---

## Step 1 — Identify current branch

```
git branch --show-current
```

Store as CURRENT_BRANCH.

---

## Step 2 — Generate commit message

Run:
```
git diff --staged
git diff
git log main..HEAD --oneline
```

Read relevant spec from `specs/` for the current feature.

Generate a Conventional Commit message:
- `feat:` new feature
- `fix:` bug fix  
- `chore:` config or tooling
- Under 72 characters, no period, describes what the user can now do

---

## Step 3 — Commit

```
git add . && git commit -m "<message>"
```

---

## Step 4 — Push

```
git push -u origin CURRENT_BRANCH
```

---

## Step 5 — Create PR

Use `gh` CLI:

```
gh pr create --title "<Feature Title>" --body "$(cat <<'EOF'
## What this PR does
<one paragraph from the spec>

## Changes
<bullet list of changed files>

## How to test
1. cd apps/sidecar && bun run dev
2. <specific steps>
EOF
)"
```

---

## Step 6 — Merge PR

```
gh pr merge --squash --delete-branch
```

---

## Step 7 — Switch to main and pull

```
git checkout main && git pull origin main
```

---

## Step 8 — Delete local branch

```
git branch -D CURRENT_BRANCH
```

---

## Final summary

```
/ship-feature complete

✓ Committed — <message>
✓ Pushed — <branch>
✓ PR created and merged
✓ Remote branch deleted
✓ Switched to main
✓ Local branch deleted

Next: /create-spec or /phase for the next feature
```

---

## Rules

- Never commit directly to main
- Always squash merge
- Always delete remote and local branch after merge
- If `gh` is not installed or not authenticated, stop and say: "GitHub CLI (gh) is not connected. Run `gh auth login` first."
- Never proceed to merge if PR creation fails
