---
description: Look up a spec by subsystem name (e.g. /spec sidecar)
---
Look up the spec for the subsystem named "$ARGUMENTS".

Map the name to the correct spec file:
- overview / principles → specs/00-overview.md
- architecture / arch / ipc / layers → specs/01-architecture.md
- sidecar / router / pipeline / react / agent → specs/02-sidecar.md
- harness / prompt / tools / hooks / guards → specs/03-harness.md
- memory / notepad / compaction / retrieval → specs/04-memory.md
- desktop / electron / tray / menubar / capture → specs/05-desktop.md
- backend / hono / auth / proxy / metering → specs/06-backend.md
- database / db / schema / drizzle → specs/07-database.md
- speech / stt / tts / elevenlabs / whisper → specs/08-speech.md
- pricing / billing / stripe / plans → specs/09-pricing.md

Read the matched file and summarise:
1. Purpose (1 sentence)
2. Key invariants (bullet list)
3. The section most relevant to the current task
