Create a spec file for a new Yomi sub-feature or component. Pass the name as argument e.g. /create-spec sidecar-visual-guide

## Step 1 — Check working directory is clean

Run `git status`. If uncommitted/unstaged/untracked files exist, stop and tell the user to commit or stash first. DO NOT CONTINUE until clean.

## Step 2 — Parse the arguments

From $ARGUMENTS extract:
1. `feature_slug` — lowercase, kebab-case, max 40 chars (e.g. `sidecar-visual-guide`)
2. `feature_title` — human readable Title Case (e.g. "Sidecar Visual Guide")

If unclear, ask the user to clarify.

## Step 3 — Check branch name is not taken

Run `git branch`. If `feature/<feature_slug>` is taken, append a number.

## Step 4 — Switch to main and pull

```
git checkout main && git pull origin main
```

## Step 5 — Create feature branch

```
git checkout -b feature/<feature_slug>
```

## Step 6 — Research the codebase

Read:
- `CLAUDE.md` — project invariants, stack, models
- `specs/00-overview.md` — phase map, glossary
- Existing specs in `specs/` — avoid duplication
- Relevant source files in `apps/` and `packages/` for the feature area

## Step 7 — Write the spec

Use this structure:

```
# Spec: <feature_title>

## Purpose
One paragraph describing what this feature does and why.

## Invariants
Non-negotiable rules this feature must respect.
Always include Yomi-specific invariants: key isolation, privacy, no AI logic in desktop.

## Detailed Design
How it works. Code snippets, data flow, interfaces. Be specific.

## Files to change
Every file that will be modified.

## Files to create
Every new file.

## Open Questions
Anything not yet decided.
```

## Step 8 — Save

Save to `specs/<feature_slug>.md`.

## Step 9 — Report

```
Branch:    feature/<feature_slug>
Spec file: specs/<feature_slug>.md
Title:     <feature_title>
```

Then tell the user: "Review the spec at `specs/<feature_slug>.md` then start implementing."
