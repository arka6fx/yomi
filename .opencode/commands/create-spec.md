---
description: Create feature branch for an existing spec and verify it's current
---
Create a feature branch for an existing spec. Pass the name as argument e.g. /create-spec sidecar

## Step 1 — Check working directory is clean

Run `git status`. If uncommitted/unstaged/untracked files exist, stop and tell the user to commit or stash first. DO NOT CONTINUE until clean.

## Step 2 — Map argument to existing spec

Map the argument to a spec file using the same mapping as /spec:
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

If no match, tell the user the valid options and stop.

Set `feature_slug` and `feature_title` based on the spec (e.g. specs/02-sidecar-fast-pipeline.md → slug `fast-pipeline`, title "Fast Pipeline"). Use sensible defaults.

## Step 3 — Check branch name is not taken

Run `git branch`. If `feature/<feature_slug>` already exists, append a number.

## Step 4 — Switch to main and pull

```
git checkout main && git pull origin main
```

## Step 5 — Create feature branch

```
git checkout -b feature/<feature_slug>
```

## Step 6 — Verify spec is current

Read the spec file. Check its "Files to change" and "Files to create" sections against the current codebase. If anything is outdated or already built, update the spec. Report what was changed.

## Step 7 — Report

```
Branch:    feature/<feature_slug>
Spec file: specs/<matched_spec>.md
Title:     <feature_title>
Status:    spec verified ✓ (or "spec updated — <changes>")
```

Then tell the user: "Ready to implement. Follow the spec at specs/<matched_spec>.md."
