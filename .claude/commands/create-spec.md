---
description: Create a spec file + feature branch — /create-spec sidecar-visual-guide
allowed-tools: Bash, Read, Write, Glob
---

Create or update a spec for `$ARGUMENTS` (required). Format: kebab-case slug, e.g. `sidecar-visual-guide`.

If `$ARGUMENTS` is empty, stop: "Usage: /create-spec <slug> — e.g. /create-spec sidecar-visual-guide"

## 1 — Clean working tree check

```bash
git status --porcelain
```

If output is non-empty, stop: "Uncommitted changes detected. Commit or stash before creating a spec branch."

## 2 — Parse slug and title

- `slug` = `$ARGUMENTS` lowercased, spaces→hyphens, max 40 chars
- `title` = Title Case of the slug words

## 3 — Create feature branch

```bash
git checkout main && git pull origin main
git checkout -b feature/<slug>
```

If the branch exists, append `-2` etc.

## 4 — Check if spec already exists

```bash
ls specs/<slug>.md 2>/dev/null
```

**If it exists**: read it, check each section against the current source files in `apps/` and `packages/`. Update stale file paths and implementation details. Report what changed. Done.

**If it does not exist**: continue to step 5.

## 5 — Research

Read:
- `CLAUDE.md` — architecture, constraints, model choices
- `specs/00-overview.md` if it exists — phase map and glossary
- Source files in `apps/` and `packages/` relevant to `<slug>`

## 6 — Write spec

Save to `specs/<slug>.md` using this template:

```markdown
# Spec: <Title>

## Purpose
<One paragraph: what this feature does and why it exists.>

## Invariants
- <Non-negotiable rule — e.g. "LLM keys stay in backend only">
- <Privacy / security constraint>

## Detailed Design
<Data flow, interfaces, sequences. Include code snippets where helpful.>

## Files to change
- `path/to/file.ts` — what changes

## Files to create
- `path/to/new-file.ts` — what it does

## Open questions
- <Unresolved decision>
```

## 7 — Report

```
Branch:    feature/<slug>
Spec file: specs/<slug>.md
Title:     <Title>

Review the spec, then start implementing. Use /check-arch before opening a PR.
```
