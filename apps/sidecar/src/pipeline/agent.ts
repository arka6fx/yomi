import { streamText } from "ai"
import type { AgentQueryRequest, SseEvent } from "@yomi/shared"
import { createModel } from "./model.js"
import { createAgentTools } from "../tools/index.js"
import { hooks } from "../harness/hooks.js"

const AGENT_PATH_MODEL = process.env.AGENT_PATH_MODEL || "claude-sonnet-4-6"
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "20", 10)

const AGENT_SYSTEM_PROMPT = `You are Yomi, an AI assistant running on the user's desktop.
You can use tools to help with multi-step tasks. Think step by step.
Write working notes to scratchpad.md during long tasks using write_file.
When done, summarise what changed and what's still open.
If a bash command would be destructive, explain and ask the user first.
Never fabricate file contents or URLs — use look_at_screen or fetch_url to verify.`

// Wrap all tool execute functions with PreToolUse / PostToolUse hook calls.
function applyHooks(tools: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      {
        ...t,
        execute: async (args: unknown, opts: unknown) => {
          const check = await hooks.preToolUse(name, args)
          if (!check.ok) {
            console.warn(`[yomi/agent] denied: ${name} — ${check.reason}`)
            return `[DENIED: ${check.reason}]`
          }
          const result = await (t.execute as (a: unknown, o: unknown) => Promise<unknown>)(args, opts)
          return hooks.postToolUse(name, result)
        },
      },
    ]),
  )
}

export async function* agentPipeline(req: AgentQueryRequest): AsyncGenerator<SseEvent> {
  const tools = applyHooks(createAgentTools({ screenshotB64: req.screenshot_b64 }))

  const result = streamText({
    model: createModel(AGENT_PATH_MODEL),
    system: AGENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: req.text }],
    tools,
    maxSteps: MAX_STEPS,
  })

  let stepCount = 0

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "text-delta":
        yield { type: "agent_text", text: event.textDelta }
        break
      case "tool-call":
        yield { type: "agent_tool_call", tool: event.toolName, args: event.args as Record<string, unknown> }
        break
      case "tool-result":
        yield { type: "agent_tool_result", tool: event.toolName, result: event.result }
        break
      case "step-finish":
        stepCount++
        yield { type: "agent_step", iteration: stepCount, max: MAX_STEPS }
        break
      case "error":
        yield { type: "error", message: event.error instanceof Error ? event.error.message : String(event.error) }
        return
    }
  }

  yield { type: "done" }
}
