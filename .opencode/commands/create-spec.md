---
description: Create a spec file + feature branch — /create-spec sidecar-visual-guide
---

Create or update a spec for `$ARGUMENTS` (required). Format: kebab-case slug.

If `$ARGUMENTS` is empty, stop: "Usage: /create-spec <slug> — e.g. /create-spec sidecar-visual-guide"

## 1 — Clean working tree check

```bash
git status --porcelain
```

If non-empty, stop: "Uncommitted changes detected. Commit or stash before creating a spec branch."

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

**If it exists**: read it, check each section against current source in `apps/` and `packages/`. Update stale paths and implementation details. Report what changed. Done.

**If it does not exist**: continue to step 5.

## 5 — Research

Read:
- `CLAUDE.md` — architecture, constraints, model choices
- `specs/00-overview.md` if it exists
- Source files in `apps/` and `packages/` relevant to `<slug>`

## 6 — Write spec

Save to `specs/<slug>.md`:

```markdown
# Spec: <Title>

## Purpose
<One paragraph: what this feature does and why.>

## Invariants
- <Non-negotiable rule>

## Detailed Design
<Data flow, interfaces, sequences. Code snippets where helpful.>

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
