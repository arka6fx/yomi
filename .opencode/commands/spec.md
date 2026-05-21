---
description: Look up a spec by subsystem name (e.g. /spec sidecar)
---
Look up the spec for the subsystem named "$ARGUMENTS".

Map the name to the correct spec file (ordered by implementation):
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

Read the matched file and summarise:
1. Purpose (1 sentence)
2. Key invariants (bullet list)
3. The section most relevant to the current task
