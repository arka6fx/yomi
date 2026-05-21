---
description: Commit, push, create PR, merge, clean up via GitHub MCP
---
Commit, push, create PR via GitHub MCP, merge, and clean up after a feature is complete.

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

## Step 5 — Create PR via GitHub MCP

Use the **github** MCP server to create a pull request from CURRENT_BRANCH into `main`.

Title: plain English feature name (no conventional commit prefix)
Body: include what this PR does, list of changes, and how to test

---

## Step 6 — Merge PR via GitHub MCP

Use the **github** MCP server to merge the pull request just created. Use squash merge.

---

## Step 7 — Delete remote branch via GitHub MCP

Use the **github** MCP server to delete CURRENT_BRANCH from GitHub after the merge.

---

## Step 8 — Switch to main and pull

```
git checkout main && git pull origin main
```

---

## Step 9 — Delete local feature branch

```
git branch -D CURRENT_BRANCH
```

---

## Final summary

```
/ship-feature complete

✓ Committed — <message>
✓ Pushed — <branch>
✓ PR created and merged via MCP
✓ Remote branch deleted
✓ Switched to main
✓ Local branch deleted

Next: /create-spec or /phase for the next feature
```

---

## Rules

- Never commit directly to main
- Always squash merge
- Always delete both remote and local branch after merge
- If GitHub MCP is not connected, stop and say: "GitHub MCP is not connected. Run `opencode mcp auth github` first."
- Never proceed to merge if PR creation fails
