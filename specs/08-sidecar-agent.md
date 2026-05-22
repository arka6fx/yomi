# Spec 08 — Sidecar: Agent Loop

## Purpose

Define the ReAct agent loop, tool set, subagent spawning, and sandboxed bash execution that land when `decision.path === "agent"` from the intent router (spec 07). The agent path handles multi-step autonomous tasks that run in the background while the user continues working. The fast path (spec 02) remains unchanged.

## Invariants

- The agent loop is capped at `MAX_ITERATIONS` (default: 20). If it loops without progress it breaks and either compacts, asks the user, or returns what it has.
- Every tool call passes through the `PreToolUse` hook — it can deny the call. No tool executes without this check.
- Subagent context is discarded after completion — only the final result is returned to the coordinator.
- Model for the agent path is `claude-sonnet-4-6` (see CLAUDE.md). Never switch models mid-turn.
- LLM keys live in the cloud backend only — never in the sidecar bundle. The sidecar reads them from env vars set by the desktop at spawn time.
- The agent produces SSE events through the same `/query` endpoint that the fast path uses; the desktop does not need to know which pipeline is running.

## Detailed Design

### Agent Loop (ReAct)

Uses `generateText` with `tools` from the Vercel AI SDK (`ai` package), matching the provider abstraction already in `pipeline/fast.ts`.

```typescript
// apps/sidecar/src/pipeline/agent.ts (sketch)
import { generateText } from "ai"
import { createModel } from "./model.js"   // shared provider factory
import { agentTools } from "../tools/index.js"
import { runHooks } from "../harness/hooks.js"

export async function* agentPipeline(req: AgentQueryRequest): AsyncGenerator<SseEvent> {
  const messages: CoreMessage[] = [
    { role: "user", content: req.text }
  ]

  let iterations = 0
  let consecutiveNonAdvancing = 0

  while (iterations < MAX_ITERATIONS) {
    const result = await generateText({
      model: createModel(AGENT_PATH_MODEL),
      system: buildAgentSystemPrompt(),
      messages,
      tools: agentTools,
      maxTokens: 4096,
    })

    for (const step of result.steps) {
      if (step.toolCalls.length > 0) {
        for (const call of step.toolCalls) {
          const allowed = await runHooks.preToolUse(call)
          if (!allowed) {
            yield { type: "agent_tool_deny", tool: call.toolName, reason: allowed.reason }
            continue
          }
          yield { type: "agent_tool_call", tool: call.toolName, args: call.args }
          const toolResult = await agentTools[call.toolName].execute(call.args)
          const trimmed = await runHooks.postToolUse(call, toolResult)
          yield { type: "agent_tool_result", tool: call.toolName, result: trimmed }
          messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: call.toolCallId, result: trimmed }] })
        }
      }

      if (step.text) {
        yield { type: "agent_text", text: step.text }
        messages.push({ role: "assistant", content: step.text })
      }
    }

    if (result.finishReason === "stop") break

    // Progress gate every 5 steps
    if (iterations > 0 && iterations % 5 === 0) {
      const advancing = checkProgress(messages)
      if (!advancing) {
        consecutiveNonAdvancing++
        if (consecutiveNonAdvancing >= 2) {
          yield { type: "agent_text", text: "I'm not making progress. I'll stop here and summarise." }
          break
        }
      } else {
        consecutiveNonAdvancing = 0
      }
    }

    iterations++
  }

  yield { type: "done" }
}
```

**Tool output trimming:** if any tool result exceeds `TOOL_OUTPUT_MAX_TOKENS` (default: 4000 tokens), trim the middle and keep head (first 30%) + tail (last 20%). Never truncate silently — log it. This is handled in `harness/hooks.ts` `postToolUse`.

### Agent Tools

Defined in `apps/sidecar/src/tools/` and composed in `apps/sidecar/src/tools/index.ts`.

**Memory tools** (`tools/memory.ts`):
- `list_files(dir: string)` — list files in `~/.yomi/`
- `read_file(path: string)` — read a notepad/project file
- `write_file(path: string, content: string)` — write to notepad
- `search(query: string)` — ripgrep across `~/.yomi/`

**System tools** (`tools/system.ts`):
- `look_at_screen()` — base64 screenshot (reuses desktop IPC or `desktopCapturer`)
- `bash(command: string, explanation: string)` — sandboxed shell; allowlist enforced by PreToolUse
- `point_cursor(x, y)` + `click()` — OS automation (macOS: `robotjs`; Linux: `xdotool`)

**Web tools** (`tools/web.ts`):
- `web_search(query: string, max_results?: number)` — returns snippets + URLs
- `fetch_url(url: string)` — HTML → markdown conversion, returns text

**MCP tools (Phase 2+):**
Google Calendar, Gmail, Notion, Slack, Browser — loaded dynamically via `mcp_connections` when user has connected them.

### Sandboxed Bash

The `bash` tool runs through `PreToolUse` in `harness/hooks.ts`.

**Allowlist (default):** `ls`, `cat`, `grep`, `rg`, `find`, `mkdir`, `cp`, `mv`, `open` (macOS), `xdg-open` (Linux), `start` (Windows), standard dev tools (`git`, `npm`, `bun`, `node`).

**Denylist (always enforced):** `rm -rf`, `sudo`, `chmod 777`, `curl | sh`, network commands pointing outside localhost.

User can extend the allowlist in `yomi.md` under `tools_allowlist: [...]`.

### Subagent Spawning

For long tasks the coordinator spawns specialised subagents with isolated context. Subagents prevent long tasks from polluting the coordinator's context window.

```typescript
// apps/sidecar/src/subagent/index.ts
export async function spawnSubagent(opts: {
  role: "researcher" | "writer" | "file-ops"
  task: string
  tools: string[]          // subset of agentTools keys
  context: string[]        // paths of ~/.yomi/ files to preload
  maxIterations?: number
}): Promise<string>        // returns only the final result text
```

Phase 2: in-process (separate context window). Out-of-process (separate sidecar instance) deferred.

### SSE Events (agent-specific additions to `SseEvent`)

The agent pipeline emits several new event types that the desktop can use to show live progress in the overlay UI:

```typescript
| { type: "agent_tool_call";   tool: string; args: Record<string, unknown> }
| { type: "agent_tool_result"; tool: string; result: unknown }
| { type: "agent_tool_deny";   tool: string; reason: string }
| { type: "agent_text";        text: string }
| { type: "agent_step";        iteration: number; max: number }
```

These are additive — the existing `llm_chunk`, `transcript`, `router_decision`, `done`, and `error` events are unchanged.

### Wiring into `/query`

`apps/sidecar/src/index.ts` has a `TODO(spec-08)` comment at line 68 where `agentPipeline` should be swapped in when `decision.path === "agent"`. Replace that TODO block:

```typescript
// Before (current):
// TODO(spec-08): swap in agentPipeline when agent route lands
const normalised: FastQueryRequest = { ...body, text }
for await (const event of fastPipeline(normalised)) { ... }

// After:
if (decision.path === "agent") {
  const agentReq: AgentQueryRequest = { text, screenshot_b64: body.screenshot_b64 }
  for await (const event of agentPipeline(agentReq)) {
    await stream.writeSSE({ data: JSON.stringify(event) })
  }
} else {
  const normalised: FastQueryRequest = { ...body, text }
  for await (const event of fastPipeline(normalised)) {
    await stream.writeSSE({ data: JSON.stringify(event) })
  }
}
```

`/query/fast` and `/query/agent` remain available for direct override (dev tools, tests).

### Harness integration

The agent loop delegates safety and logging to `harness/hooks.ts` (spec 09). The agent pipeline should import and call:
- `runHooks.preToolUse(call)` before every tool execution
- `runHooks.postToolUse(call, result)` after, for trimming and logging
- `runHooks.onStop(summary)` when the loop ends

Hooks are a thin shim in spec 08 (no-ops or simple console.warn); the full implementation lands with spec 09.

## Files to change

- `apps/sidecar/src/index.ts` — replace `TODO(spec-08)` block: route `agent` path to `agentPipeline`, add `/query/agent` direct override route
- `packages/shared/src/index.ts` — add agent SSE event variants (`agent_tool_call`, `agent_tool_result`, `agent_tool_deny`, `agent_text`, `agent_step`) to the `SseEvent` union

## Files to create

- `apps/sidecar/src/pipeline/agent.ts` — ReAct agent loop (`agentPipeline` generator)
- `apps/sidecar/src/pipeline/model.ts` — shared `createModel(modelId)` factory (extracted from `fast.ts` so both pipelines share it)
- `apps/sidecar/src/tools/index.ts` — compose and export all agent tools as a single `agentTools` record
- `apps/sidecar/src/tools/memory.ts` — `list_files`, `read_file`, `write_file`, `search`
- `apps/sidecar/src/tools/system.ts` — `look_at_screen`, `bash`, `point_cursor`, `click`
- `apps/sidecar/src/tools/web.ts` — `web_search`, `fetch_url`
- `apps/sidecar/src/subagent/index.ts` — `spawnSubagent` coordinator
- `apps/sidecar/src/harness/hooks.ts` — stub `PreToolUse` / `PostToolUse` / `onStop` hooks (full implementation in spec 09)

## Open Questions

- Subagent isolation: in-process (separate context window) vs out-of-process (separate sidecar instance). In-process is simpler for Phase 2.
- OS automation reliability: coordinate-based click is fragile — consider accessibility-tree-based targeting for Phase 2+.
- Web search provider: use Brave Search API (needs `BRAVE_SEARCH_API_KEY`) or a scraping approach. Brave is cleaner; decide before implementing `tools/web.ts`.
- Duplicate tool call detection (same tool + same args 3 times in a row → break) belongs here or in `harness/guards.ts` (spec 09)? Lean toward guards.ts to keep the loop clean.
