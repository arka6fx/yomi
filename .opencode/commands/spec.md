---
description: Look up or list specs — /spec sidecar or /spec (list all)
---

Look up a spec file. `$ARGUMENTS` is a keyword (subsystem name or partial file name). If empty, list all specs.

## If `$ARGUMENTS` is empty — list all

```bash
ls specs/
```

Print each spec file with its first `## Purpose` paragraph (one line). Let the user pick.

## If `$ARGUMENTS` is provided — find and read

1. Glob `specs/**` for files whose name contains `$ARGUMENTS` (case-insensitive).
2. If multiple match, list them and ask the user to pick.
3. If exactly one matches, read it in full.
4. If none match, try common aliases:

| Alias | File pattern |
|---|---|
| overview, intro | `00-overview*` |
| arch, ipc, layers | `01-architecture*` |
| sidecar, router, pipeline, agent | `02-sidecar*` |
| harness, hooks, prompt | `03-harness*` |
| memory, notepad, compaction | `04-memory*` |
| desktop, electron, tray | `05-desktop*` |
| backend, hono, auth, proxy | `06-backend*` |
| db, database, drizzle, schema | `07-database*` |
| speech, stt, tts, whisper | `08-speech*` |
| pricing, billing, plans | `09-pricing*` |

If still no match: "No spec found for '$ARGUMENTS'. Run `/create-spec $ARGUMENTS` to create one."

## Output

```
Spec: <filename>

Purpose
<one paragraph>

Key invariants
<bullet list>

Design summary
<most relevant section — ~40 lines max>
```
