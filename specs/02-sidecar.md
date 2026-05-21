# Spec 02 — Sidecar

## Purpose

Define the intent router, fast pipeline, ReAct agent loop, and subagent spawning. The sidecar is the entire AI brain of Yomi.

## Invariants

- The router runs at the START of every turn. It classifies once and commits.
- The fast path never enters a tool-selection loop. It makes exactly one LLM call.
- The agent loop is capped at N iterations (default: 20). If it loops without progress, it breaks and either compacts, asks the user, or returns what it has.
- The sidecar holds no API keys. All model calls go through the backend proxy.

## Detailed Design

### Intent Router

A lightweight classification call made before routing. Uses a small/fast model.

```
Input:  transcript + screenshot (if available) + last 2 turns of history
Output: { path: "fast" | "agent", confidence: number, reason: string }
```

**Fast path signals:**
- Question form ("what", "how", "explain", "what does this mean")
- Single-step request ("translate this", "summarise this text")
- No verbs implying multi-step action ("research", "draft", "send", "schedule", "create")

**Agent path signals:**
- Action verbs: "research", "draft", "send", "schedule", "book", "create", "open", "file"
- Explicit trigger: "Yomi agent, ..."
- Multi-part: "and then", "also", "after that"

Default to fast path on ambiguity (bias toward latency).

### Fast Pipeline

```
ElevenLabs STT (streaming)
  ↓  partial transcripts feed the LLM before VAD fires
Speculative screenshot (grabbed at hotkey press, parallel to STT)
  ↓
Vercel AI SDK streamText
  model: FAST_PATH_MODEL (default: claude-haiku-4-5-20251001)
  system: cached system prompt + yomi.md
  messages: [{ role: "user", content: [text, image_url] }]
  maxTokens: 800
  ↓
ElevenLabs TTS streaming
  ↓
SSE audio_chunk stream to desktop
```

**Prompt caching:** The system prompt + `yomi.md` content are placed before the first user message to hit Anthropic's cache. Every fast-path call pays only for the new tokens.

### Visual Guidance Mode

When the user asks for step-by-step guidance ("show me how to...", "guide me through..."), the fast path runs in `guide` mode. It produces a visual overlay on the user's screen with arrows and labels pointing to UI elements.

**Flow:**
```
1. User: "guide me through sending a message in Discord"
2. Screenshot captured (current state of the app)
3. LLM call with structured output schema:
   {
     steps: [
       {
         instruction: string,      // human-readable step
         elements: {               // UI elements to highlight
           label: string,
           bbox: { x, y, width, height }  // pixel coordinates in screenshot
         }[]
       }
     ]
   }
4. Sidecar emits SSE visual_guide chunks, one per step
5. Desktop renders a transparent overlay with arrows/labels at each bbox
6. User presses Next/Prev to step through
```

**LLM prompt guide mode:** append to the system prompt:
```
You are in guide mode. The user wants you to show them how to do something step by step.
For each step, return:
- instruction: a short instruction the user can follow
- elements: UI elements from the screenshot to highlight, with bounding box coordinates in pixels

Keep instructions to 1 sentence. Highlight only the relevant UI element per step
(e.g. the button to click, the field to type in).
```

**Fallback:** if the LLM cannot identify UI elements (unclear screenshot, non-standard UI), it falls back to text-only instructions with no visual overlay. Emit `visual_guide` with `elements: []`. The desktop shows just the text step.

**Speculative screenshot:** grabbed the instant push-to-talk starts (not after VAD fires). This means vision context is ready when the transcript lands. ~200ms savings.

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
      await hooks.preToolUse(call)        // can deny
      const result = await tools.execute(call)
      await hooks.postToolUse(call, result) // can trim
      conversationHistory.push({ role: "tool", content: result })
    }
  }

  // Progress check every 5 iterations
  if (iterations % 5 === 0) {
    const progress = await checkProgress(goal, conversationHistory)
    if (!progress.advancing) { compactAndAsk(); break }
  }

  iterations++
}
```

**Tool output trimming:** if any tool result exceeds `TOOL_OUTPUT_MAX_TOKENS` (default: 4000), trim the middle and keep the head + tail. Never truncate tool results silently — log it.

### Agent Tools (full set)

**Memory tools:**
- `list_files(dir: string)` — list files in `~/.yomi/`
- `read_file(path: string)` — read a memory/project file
- `write_file(path: string, content: string)` — write to notepad
- `search(query: string)` — ripgrep across `~/.yomi/`

**System tools:**
- `look_at_screen()` → base64 screenshot
- `bash(command: string)` — sandboxed shell (allowlist enforced by PreToolUse hook)
- `point_cursor(x, y)` + `click()` — OS automation

**Web tools:**
- `web_search(query: string)` — search results
- `fetch_url(url: string)` → text content (markdown-converted)

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
// Coordinator uses result, subagent context discarded
```

Subagents prevent long tasks from polluting the coordinator's context window.

### Sandboxed Bash

The `bash` tool runs through a restricted shell:

**Allowlist (default):** `ls`, `cat`, `grep`, `rg`, `find`, `mkdir`, `cp`, `mv`, `open` (macOS), `xdg-open` (Linux), `start` (Windows), standard dev tools.

**Denylist (enforced by PreToolUse):** `rm -rf`, `sudo`, `chmod 777`, `curl | sh`, network commands pointing outside localhost.

User can extend the allowlist in `yomi.md` with `tools_allowlist: [...]`.

## Files to change

- `apps/sidecar/src/index.ts` — Hono server entry point, route registration
- `packages/shared/src/index.ts` — IPC type definitions

## Files to create

- `apps/sidecar/src/router/intent.ts` — Intent router (classifies fast vs agent)
- `apps/sidecar/src/pipeline/fast.ts` — Fast pipeline (STT → LLM → TTS → SSE)
- `apps/sidecar/src/pipeline/agent.ts` — ReAct agent loop
- `apps/sidecar/src/pipeline/visual-guide.ts` — Visual guidance mode
- `apps/sidecar/src/tools/memory.ts` — list_files, read_file, write_file, search
- `apps/sidecar/src/tools/system.ts` — look_at_screen, bash, cursor automation
- `apps/sidecar/src/tools/web.ts` — web_search, fetch_url
- `apps/sidecar/src/subagent/index.ts` — Subagent spawning

## Open Questions

- Intent router: use a dedicated classifier call vs embed the classification in the first token of the LLM response (saves a round-trip).
- Subagent isolation: in-process (separate context window) vs out-of-process (separate sidecar instance). In-process is simpler for Phase 2.
