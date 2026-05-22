import { streamText } from "ai"
import type { AgentQueryRequest, SseEvent } from "@yomi/shared"
import { createModel } from "./model.js"
import { createAgentTools } from "../tools/index.js"
import { hooks } from "../harness/hooks.js"
import { buildAgentPrompt, loadYomiMd } from "../harness/prompt.js"
import { LoopGuards } from "../harness/guards.js"

const AGENT_PATH_MODEL = process.env.AGENT_PATH_MODEL || "claude-sonnet-4-6"
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "20", 10)

// Cached per-process; yomi.md is stable for the lifetime of a sidecar session.
let cachedAgentPrompt: string | null = null
async function getAgentPrompt(): Promise<string> {
  if (!cachedAgentPrompt) {
    cachedAgentPrompt = buildAgentPrompt({ yomiMd: await loadYomiMd() })
  }
  return cachedAgentPrompt
}

// Wrap all tool execute functions with PreToolUse / PostToolUse hook calls.
function applyHooks(tools: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      {
        ...t,
        execute: async (args: unknown, opts: unknown) => {
          const check = await hooks.onPreToolUse(name, args)
          if (!check.ok) {
            console.warn(`[yomi/agent] denied: ${name} — ${check.reason}`)
            return `[DENIED: ${check.reason}]`
          }
          const result = await (t.execute as (a: unknown, o: unknown) => Promise<unknown>)(args, opts)
          return hooks.onPostToolUse(name, result)
        },
      },
    ]),
  )
}

export async function* agentPipeline(req: AgentQueryRequest): AsyncGenerator<SseEvent> {
  const tools = applyHooks(createAgentTools({ screenshotB64: req.screenshot_b64 }))
  const system = await getAgentPrompt()
  const guards = new LoopGuards()

  const result = streamText({
    model: createModel(AGENT_PATH_MODEL),
    system,
    messages: [{ role: "user", content: req.text }],
    tools,
    maxSteps: MAX_STEPS,
  })

  let stepCount = 0
  // Keep a rolling tail for the onStop summary (avoid unbounded accumulation).
  let textTail = ""

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "text-delta":
        textTail = (textTail + event.textDelta).slice(-200)
        yield { type: "agent_text", text: event.textDelta }
        break
      case "tool-call": {
        const guard = guards.onToolCall(event.toolName, event.args as Record<string, unknown>)
        yield { type: "agent_tool_call", tool: event.toolName, args: event.args as Record<string, unknown> }
        if (guard.break) {
          yield { type: "error", message: guard.reason }
          await hooks.onStop(guard.reason)
          return
        }
        break
      }
      case "tool-result":
        yield { type: "agent_tool_result", tool: event.toolName, result: event.result }
        break
      case "step-finish": {
        stepCount++
        yield { type: "agent_step", iteration: stepCount, max: MAX_STEPS }
        const guard = guards.onStep()
        if (guard.break) {
          yield { type: "error", message: guard.reason }
          await hooks.onStop(guard.reason)
          return
        }
        break
      }
      case "error":
        yield { type: "error", message: event.error instanceof Error ? event.error.message : String(event.error) }
        return
    }
  }

  const summary = textTail.replace(/\n/g, " ").trim() || "agent task complete"
  await hooks.onStop(summary)
  yield { type: "done" }
}
