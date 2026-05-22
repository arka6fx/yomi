# Spec 09 — Harness

## Purpose

Define the system prompt design, tool schemas, session lifecycle state machine, hooks, and anti-hallucination guards. The harness is where all engineering effort goes — the model is a black box.

## Invariants

- The system prompt is **hybrid**: a generalizable core + a small set of worked examples (≤ 5). Not pure-vague, not pure-cases.
- Tool schemas must match the model family's post-training vocab. Claude models get Edit + Bash-shaped tools.
- Hooks fire at every lifecycle boundary. No AI behavior change is allowed without a hook point.
- No tool call is executed without passing through `PreToolUse`. `PreToolUse` can deny.

## Detailed Design

### System Prompt Template

```
<identity>
You are Yomi, an AI buddy running on {{user.name}}'s {{os}} desktop.
You see their screen, hear their voice, and act on their behalf.
Resolve the user's intent directly. Be useful. Be brief. Ask only when blocked.
</identity>

<user_context>
{{yomi_md_content}}
</user_context>

<capabilities>
Fast path: you answer questions, explain what's on screen, or take one quick action.
Agent path: you research, draft, file, schedule — multi-step tasks run in the background.
You always have: look_at_screen, read_file, write_file, search, bash (sandboxed).
On agent path you also have: web_search, fetch_url, bash (full), MCP tools.
</capabilities>

<examples>
{{high_signal_examples}}
</examples>

<rules>
- Never fabricate file contents or URLs. Use look_at_screen or fetch_url to verify.
- If a bash command would be destructive, ask first.
- Write your working notes to scratchpad.md during long tasks.
- When done, summarise what changed and what's still open.
</rules>
```

**High-signal examples (≤ 5):**
1. Screen Q&A: "what does this error mean?" → read screen, answer in 2 sentences
2. Quick fix: "fix this" → read screen, bash, confirm
3. Research + draft: "research X and draft an email" → web_search loop → write draft → ask to send
4. Schedule: "book lunch with Riya on Friday" → calendar MCP → confirm slot → create event
5. File operation: "move all screenshots to /Desktop/screenshots" → bash + confirm

### Tool Schemas (fast path)

```typescript
tools.lookAtScreen = {
  description: "Capture a screenshot of the user's current screen",
  parameters: z.object({}),
  execute: async () => ({ image: await captureScreen() })
}

tools.transcribe = {
  description: "Get the user's spoken words as text",
  parameters: z.object({}),
  execute: async () => ({ text: latestTranscript })
}

tools.speak = {
  description: "Speak a response aloud to the user",
  parameters: z.object({ text: z.string() }),
  execute: async ({ text }) => elevenLabs.tts(text)
}
```

### Tool Schemas (agent path additions)

```typescript
tools.bash = {
  description: "Run a shell command. Only commands on the allowlist will execute.",
  parameters: z.object({ command: z.string(), explanation: z.string() }),
}

tools.webSearch = {
  description: "Search the web for information",
  parameters: z.object({ query: z.string(), max_results: z.number().default(5) }),
}

tools.fetchUrl = {
  description: "Fetch the text content of a URL (returns markdown)",
  parameters: z.object({ url: z.string().url() }),
}

tools.writeFile = {
  description: "Write content to a file in the notepad (~/.yomi/)",
  parameters: z.object({ path: z.string(), content: z.string() }),
}
```

### Session Lifecycle State Machine

```
IDLE
  → [hotkey press] → LISTENING
LISTENING
  → [VAD end-of-speech / manual release] → ROUTING
ROUTING
  → [router returns "fast"] → FAST_PIPELINE
  → [router returns "agent"] → AGENT_RUNNING
FAST_PIPELINE
  → [TTS complete] → IDLE
  → [error] → IDLE (with error toast)
AGENT_RUNNING
  → [task complete] → COMPACTING
  → [user cancels] → COMPACTING
  → [max iterations] → COMPACTING
COMPACTING
  → [memory written] → IDLE
```

### Hook Points

```typescript
interface Hooks {
  onSessionStart(): Promise<void>
  onUserPromptSubmit(prompt: string): Promise<void>
  onPreToolUse(call: ToolCall): Promise<ToolCall | { deny: true; reason: string }>
  onPostToolUse(call: ToolCall, result: ToolResult): Promise<ToolResult>
  onStop(summary: string): Promise<void>
  onSessionEnd(): Promise<void>
}
```

**Default hook implementations:**

`onPreToolUse`: check bash command against denylist regexes. Deny `rm -rf /`, `sudo rm`, `curl|sh`, `chmod 777`. Stub exists in `harness/hooks.ts` as `preToolUse` — rename to match interface.

`onPostToolUse`: if output text > 16 000 chars (~4 000 tokens), trim middle (keep first 50% + last 30%). Log trim. Stub exists as `postToolUse` — rename.

`onStop`: append one-line summary to `~/.yomi/sessions/YYYY-MM-DD-dev.md`. Create file if absent.

`onSessionEnd`: if `~/.yomi/memory.md` > 50 KB, log a compaction-needed warning (actual compaction is spec 10).

`onSessionStart` / `onUserPromptSubmit`: no-ops for now; hook points must exist for spec 10 to attach to.

### Anti-Hallucination / Runaway-Loop Guards

1. **Iteration cap:** `MAX_ITERATIONS = 20`. Hard stop.
2. **Progress gate (every 5 steps):** classify whether the conversation is advancing toward the goal. Metric: number of open sub-tasks decreasing. If not advancing for 2 consecutive checks → break.
3. **Tool output trim:** any tool result > 4000 tokens → trim middle, keep head + tail.
4. **Duplicate tool call detection:** if the same tool is called with the same args 3 times in a row → break loop, surface to user.
5. **Model vocab lock:** never switch models mid-conversation. Route once at turn start.

## Files to change

- `apps/sidecar/src/pipeline/fast.ts` — replace inline `ANSWER_SYSTEM_PROMPT` with `buildFastPrompt()` from `harness/prompt.ts`
- `apps/sidecar/src/pipeline/agent.ts` — replace inline `AGENT_SYSTEM_PROMPT` with `buildAgentPrompt()` from `harness/prompt.ts`; wire `onStop` / `onSessionEnd` hooks
- `apps/sidecar/src/harness/hooks.ts` — expand stub (from spec 08) with full `Hooks` interface: add `onSessionStart`, `onUserPromptSubmit`, `onStop` (session file append), `onSessionEnd` (compaction trigger); rename exported object fields to match the interface

## Files to create

- `apps/sidecar/src/harness/prompt.ts` — `buildFastPrompt(ctx)` and `buildAgentPrompt(ctx)` where `ctx = { userName, os, yomiMd }`. Returns string with `<identity>`, `<user_context>`, `<capabilities>`, `<examples>`, `<rules>` sections. Anthropic cache-control applied to system messages by callers.
- `apps/sidecar/src/harness/tools.ts` — canonical tool-schema objects for `lookAtScreen`, `transcribe`, `speak` (fast path) and `bash`, `webSearch`, `fetchUrl`, `writeFile` (agent additions). Re-export from `tools/index.ts` where overlapping.
- `apps/sidecar/src/harness/state-machine.ts` — `SessionState` enum + `SessionMachine` class with `transition(event)`. States: `IDLE → LISTENING → ROUTING → FAST_PIPELINE | AGENT_RUNNING → COMPACTING → IDLE`. Fires the `Hooks` callbacks at each boundary.
- `apps/sidecar/src/harness/guards.ts` — `LoopGuards` class consumed by `agentPipeline`. Guards: iteration cap (hard stop at `MAX_ITERATIONS=20`), progress gate (check every 5 steps, break after 2 stalled checks), duplicate-tool detection (same name+args 3× in a row → break), tool-output trim (already in `hooks.postToolUse` — delegate there, don't duplicate).

## Current Codebase State (as of spec 08)

| File | Status |
|---|---|
| `apps/sidecar/src/harness/hooks.ts` | Stub — `preToolUse` + `postToolUse` only; no full `Hooks` interface |
| `apps/sidecar/src/pipeline/fast.ts` | Uses inline `ANSWER_SYSTEM_PROMPT`; no harness template |
| `apps/sidecar/src/pipeline/agent.ts` | Uses inline `AGENT_SYSTEM_PROMPT`; already imports `hooks` from harness |
| `apps/sidecar/src/harness/prompt.ts` | Does not exist |
| `apps/sidecar/src/harness/tools.ts` | Does not exist |
| `apps/sidecar/src/harness/state-machine.ts` | Does not exist |
| `apps/sidecar/src/harness/guards.ts` | Does not exist |

## Open Questions

- Example selection: static set vs dynamically retrieved from memory based on the current task type.
- Progress gate (guard #2): heuristic (count open sub-tasks in scratchpad) vs. small LLM call to classify progress. Heuristic preferred to avoid cost.
- Hook persistence: hooks run in-process in the sidecar (Phase 2); consider out-of-process for isolation (Phase 3+).
