# Spec 06 — Sidecar: Agent Loop

## Purpose

Define the ReAct agent loop, tool set, subagent spawning, and sandboxed bash execution. The agent path handles multi-step autonomous tasks that run in the background.

## Invariants

- The agent loop is capped at N iterations (default: 20). If it loops without progress, it breaks and either compacts, asks the user, or returns what it has.
- Every tool call passes through `PreToolUse` hook — it can deny the call.
- Subagent context is discarded after completion — only the result is returned to the coordinator.

## Detailed Design

### Agent Loop (ReAct)

```typescript
while (iterations < MAX_ITERATIONS) {
  const response = await llm.generate({
    model: AGENT_PATH_MODEL,
    system: agentSystemPrompt + yomiMd + memorySummary,
    messages: conversationHistory,
    tools: agentTools,
  })

  if (response.finishReason === "stop") break
  if (response.finishReason === "tool_calls") {
    for (const call of response.toolCalls) {
      await hooks.preToolUse(call)
      const result = await tools.execute(call)
      await hooks.postToolUse(call, result)
      conversationHistory.push({ role: "tool", content: result })
    }
  }

  if (iterations % 5 === 0) {
    const progress = await checkProgress(goal, conversationHistory)
    if (!progress.advancing) { compactAndAsk(); break }
  }

  iterations++
}
```

**Tool output trimming:** if any tool result exceeds `TOOL_OUTPUT_MAX_TOKENS` (default: 4000), trim the middle and keep the head + tail. Never truncate silently — log it.

### Agent Tools

**Memory tools:**
- `list_files(dir: string)` — list files in `~/.yomi/`
- `read_file(path: string)` — read a memory/project file
- `write_file(path: string, content: string)` — write to notepad
- `search(query: string)` — ripgrep across `~/.yomi/`

**System tools:**
- `look_at_screen()` — base64 screenshot
- `bash(command: string)` — sandboxed shell (allowlist enforced by PreToolUse)
- `point_cursor(x, y)` + `click()` — OS automation

**Web tools:**
- `web_search(query: string)` — search results
- `fetch_url(url: string)` — text content (markdown-converted)

**MCP tools (Phase 2+):**
- Google Calendar, Gmail, Notion, Slack, Browser (via MCP server connections)

### Subagent Spawning

For long tasks, the coordinator spawns specialised subagents with isolated context:

```typescript
const subagent = await spawnSubagent({
  role: "researcher" | "writer" | "file-ops",
  task: string,
  tools: subsetOfTools,
  context: relevantMemoryFiles,
  maxIterations: 10,
})
const result = await subagent.run()
```

Subagents prevent long tasks from polluting the coordinator's context window.

### Sandboxed Bash

The `bash` tool runs through a restricted shell:

**Allowlist (default):** `ls`, `cat`, `grep`, `rg`, `find`, `mkdir`, `cp`, `mv`, `open` (macOS), `xdg-open` (Linux), `start` (Windows), standard dev tools.

**Denylist (enforced by PreToolUse):** `rm -rf`, `sudo`, `chmod 777`, `curl | sh`, network commands pointing outside localhost.

User can extend the allowlist in `yomi.md` with `tools_allowlist: [...]`.

## Files to change

- `apps/sidecar/src/index.ts` — register agent route

## Files to create

- `apps/sidecar/src/pipeline/agent.ts` — ReAct agent loop
- `apps/sidecar/src/tools/memory.ts` — list_files, read_file, write_file, search
- `apps/sidecar/src/tools/system.ts` — look_at_screen, bash, cursor automation
- `apps/sidecar/src/tools/web.ts` — web_search, fetch_url
- `apps/sidecar/src/subagent/index.ts` — Subagent spawning

## Open Questions

- Subagent isolation: in-process (separate context window) vs out-of-process (separate sidecar instance). In-process is simpler for Phase 2.
- OS automation reliability: coordinate-based click is fragile — consider accessibility-tree-based targeting for Phase 2+.
