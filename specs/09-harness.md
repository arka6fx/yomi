# Spec 09 - Harness

Harness = system prompt, tools, connectors, memory, hooks, and loop guards.

Prompt inputs:

- User profile from `~/.yomi/yomi.md`.
- Static and dynamic memory profiles.
- Local retrieved memory.
- Cloud retrieved memory and RAG context.
- Recent session turns.
- Connected connector list.
- Optional screenshot for the current local turn.

Hooks:

- `PreToolUse` blocks dangerous shell patterns and plugin-denied calls.
- `PostToolUse` trims large outputs and lets plugins observe results.
- `Stop` writes summaries.
- `SessionEnd` flushes queued memory/session writes.

Loop guards stop repeated identical tool calls and long no-progress runs.
