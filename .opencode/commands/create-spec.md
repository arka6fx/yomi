---
description: Create feature branch for a spec — matches existing or auto-generates new
---
Create a feature branch for a spec. If the name matches an existing spec, verify it. If not, auto-generate a new spec. Pass the name as argument e.g. /create-spec my-feature

## Step 1 — Check working directory is clean

Run `git status`. If uncommitted/unstaged/untracked files exist, stop and tell the user to commit or stash first. DO NOT CONTINUE until clean.

## Step 2 — Parse argument

From $ARGUMENTS extract `feature_slug` (lowercase, kebab-case, max 40 chars) and `feature_title` (human readable Title Case). If unclear, ask.

## Step 3 — Try mapping to existing spec

Check if the argument matches any known spec name using this mapping:
- overview / principles → specs/00-overview.md
- architecture / arch / ipc / layers → specs/01-architecture.md
- fast-pipeline / pipeline / fast → specs/02-sidecar-fast-pipeline.md
- intent / router / classify → specs/03-sidecar-router.md
- stt / speech-to-text / elevenlabs-stt / whisper → specs/04-speech-stt.md
- tts / text-to-speech / elevenlabs-tts / piper / edge-tts → specs/05-speech-tts.md
- agent / react / tools / subagent / sandbox → specs/06-sidecar-agent.md
- harness / prompt / hooks / guards → specs/07-harness.md
- memory / notepad / compaction / retrieval → specs/08-memory.md
- backend / hono / auth / proxy / metering → specs/09-backend.md
- database / db / schema / drizzle → specs/10-database.md
- pricing / billing / stripe / plans → specs/11-pricing.md
- desktop / electron / shell / capture → specs/12-desktop-shell.md
- ui / overlay / guide / floating-window → specs/13-desktop-ui.md

**If matched:** go to Step 4 (existing spec path).

**If no match:** go to Step 8 (auto-generate new spec path).

## Step 4 — Check branch name (existing spec)

Run `git branch`. If `feature/<feature_slug>` already exists, append a number.

## Step 5 — Switch to main and pull

```
git checkout main && git pull origin main
```

## Step 6 — Create feature branch

```
git checkout -b feature/<feature_slug>
```

## Step 7 — Verify existing spec is current

Read the spec file. Check its "Files to change" and "Files to create" sections against the current codebase. If anything is outdated or already built, update the spec. Report what was changed. Then go to Step 11.

---

## Step 8 — Determine next serial number

Run `ls specs/*.md | wc -l` and zero-pad to 2 digits (e.g. 14 → `14`). The new spec number is the count (since existing files are 00–13).

## Step 9 — Research codebase (new spec)

Read:
- `CLAUDE.md` — project invariants, stack, models
- `specs/00-overview.md` — principles, glossary
- Existing specs in `specs/` — avoid duplication
- Relevant source files in `apps/` and `packages/` for the feature area

## Step 10 — Check branch name (new spec)

Run `git branch`. If `feature/<feature_slug>` already exists, append a number.

## Step 11 — Create branch + write spec

```
git checkout main && git pull origin main
git checkout -b feature/<feature_slug>
```

Write the spec to `specs/<NN>-<feature_slug>.md` using this structure:

```
# Spec <NN> — <feature_title>

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

## Step 12 — Report

```
Branch:    feature/<feature_slug>
Spec file: specs/<NN>-<feature_slug>.md
Title:     <feature_title>
Status:    spec created — new (#NN)
```

Then tell the user: "Ready to implement. Follow the spec at specs/<NN>-<feature_slug>.md."
