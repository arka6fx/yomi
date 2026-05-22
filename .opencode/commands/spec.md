---
description: Look up a spec by subsystem name (e.g. /spec sidecar)
---
Look up the spec for the subsystem named "$ARGUMENTS".

Map the name to the correct spec file (ordered by implementation):
- overview / principles → specs/00-overview.md
- architecture / arch / ipc / layers → specs/01-architecture.md
- fast-pipeline / pipeline / fast → specs/02-sidecar-fast-pipeline.md
- desktop-shell / shell / electron / main / preload / capture → specs/03-desktop-shell.md
- desktop-ui / ui / overlay / guide / buddy / floating-window → specs/04-desktop-ui.md
- stt / speech-to-text / whisper / transcribe → specs/05-speech-stt.md
- tts / text-to-speech / resolver / openai-tts → specs/06-speech-tts.md
- router / intent / classify → specs/07-sidecar-router.md
- agent / react / tools / subagent / sandbox → specs/08-sidecar-agent.md
- harness / prompt / hooks / guards → specs/09-harness.md
- memory / notepad / compaction / retrieval → specs/10-memory.md
- database / db / schema / drizzle → specs/11-database.md
- backend / hono / auth / proxy / metering → specs/12-backend.md
- pricing / billing / razorpay / plans → specs/13-pricing.md

Read the matched file and summarise:
1. Purpose (1 sentence)
2. Key invariants (bullet list)
3. The section most relevant to the current task
