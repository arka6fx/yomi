# Spec 09 - Harness

Harness = system prompt, tools, connectors, memory, hooks, and loop guards.

Prompt inputs:

- User profile and static/dynamic memory profiles from backend-canonical
  memory.
- Cloud retrieved memory and RAG context.
- Recent session turns.
- Connected connector list.
- Image the user sent in the current Telegram turn, when present.

Hooks:

- `PreToolUse` blocks dangerous shell patterns and plugin-denied calls.
- `PostToolUse` trims large outputs and lets plugins observe results.
- `Stop` writes summaries.
- `SessionEnd` flushes queued memory/session writes.

Loop guards stop repeated identical tool calls and long no-progress runs.
