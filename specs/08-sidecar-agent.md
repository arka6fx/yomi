# Spec 08 — Sidecar: Agent Pipeline

## Purpose

Define the ReAct loop that handles complex multi-step requests routed as
`agent`. The agent pipeline runs inside the sidecar and has access to a
sandboxed tool runtime, memory, and subagent orchestration. Default model:
`gpt-4.1`.

## Invariants

- Tool execution happens in a sandboxed Node.js subprocess.
- Each turn appends to a shared `Turn` type:
  `{ role, text, tool_calls[], tool_results[] }`.
- The loop terminates when `stopReason` is `"tool_use_stop"` (no tool call
  requested) or after `MAX_AGENT_TURNS` (default 15).
- The agent model never changes mid-loop.

## Detailed Design

### ReAct Loop

The core loop is a `while (true)` that cycles through: **think → act → observe →
repeat**.

```
input → [system prompt + memory + turn history] → LLM generates text + tool_calls
  → for each tool_call:
      → execute in sandbox → record result as ToolResult
  → append { role: "assistant", text, tool_calls } and { role: "tool", tool_results } to turns
  → check stop conditions → either stop or loop back
```

Implementation uses Vercel AI SDK's `streamText` with maxSteps. The SDK natively
implements the ReAct loop: each LLM response may include tool calls, and the SDK
feeds tool results back automatically until the model stops requesting tools or
`maxSteps` is reached.

```typescript
const result = streamText({
  model: createAgentModel(),
  system: buildSystemPrompt(),
  messages: conversation,
  tools: agentTools,
  maxSteps: MAX_AGENT_TURNS,
  onStepFinish: ({ text, toolCalls, toolResults, stepType }) => {
    activeTurns++
    emit("agent_step", {
      step: activeTurns,
      text,
      tool_calls,
      tool_results: toolResults,
      type: stepType,
    })
  },
})
```

### Tool structure

```ts
// packages/shared/src/index.ts
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema (can be produced by zod-to-json-schema)
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  tool_call_id: string
  output: string // JSON-serialised
}
```

### Tools

Each tool is defined outside the sandbox and dispatched by the sandbox back to
the sidecar process for actual execution. This keeps the sandbox pure.

**Phase 0 tools:**

- `screenshot` — captures current screen, returns b64-encoded JPEG.
- `bash` — executes shell command in sandbox.
- `read` — reads a file from the sandbox filesystem.
- `write` — writes a file to the sandbox filesystem.
- `web_search` — performs a web search.
- `web_fetch` — fetches a URL.

**Future tools:**

- `edit` — edit a range in an existing file (±5 context lines).
- `glob` — glob-pattern file search.
- `grep` — regex search across files.
- `memory_store`/`memory_recall` — explicit memory read/write.
- gh tools: `gh_create_pr`, `gh_create_issue`, `gh_push`.

### Sandbox

The sandbox is a child process running an isolated Node.js VM:

```typescript
const sandbox = fork(path.join(__dirname, "sandbox-worker.js"), [], {
  execArgv: ["--experimental-vm-modules"],
  env: { ...isolatedEnv }, // no OPENAI_API_KEY, no network — tools proxy back to sidecar
  stdio: ["pipe", "pipe", "pipe", "ipc"],
})
```

The sandbox worker exposes `execute({ tool, args })` and returns the result via
IPC. The sandbox has:

- No access to `process.env` (no keys leaked)
- No network access (blocked at OS level via `isolatedEnv` or network namespace)
- Only explicitly granted filesystem access (temp workspace dir)

### Subagent orchestration

When a tool call identifies a complex subtask (e.g. "draft a detailed report"),
the sidecar can spin up a subagent:

```typescript
const subagent = spawnSubagent({
  goal: "Draft a detailed report on X",
  context: { turns: history, files: [...], memory: ... },
  maxSteps: 10,
})
subagent.on("step", (s) => emit("subagent_step", s))
const result = await subagent.done()
```

Subagents share the same tool set but have a narrower system prompt focused on
their goal.

Subagent model defaults to `gpt-4.1` (same as agent pipeline).

### Wiring

- The `/query` endpoint routes to this pipeline based on
  `IntentClassification.path === "agent"`.
- SSE events emitted: `agent_step`, `agent_final`, `agent_error`,
  `subagent_step`.

### Files to change

- `apps/sidecar/src/index.ts` — add `/query/agent` handler.
- `apps/sidecar/src/pipeline/agent.ts` — agent pipeline with ReAct loop using
  `streamText` + `maxSteps`.

### Files to create

- `apps/sidecar/src/sandbox/sandbox-worker.ts` — child process for isolated tool
  execution.
- `apps/sidecar/src/sandbox/tools.ts` — tool definitions map (name → handler).
- `apps/sidecar/src/subagent/index.ts` — subagent spawner.

## Open Questions

- Should the sandbox be a Docker container instead of a child process? →
  Phase 1. Phase 0 uses child process with env stripping.
- How do we stream large tool outputs back to the agent without exceeding
  context? → truncation with `... (X more chars)`.
