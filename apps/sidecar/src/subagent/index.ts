import { generateText } from "ai"
import { join } from "path"
import { homedir } from "os"
import { readFile } from "fs/promises"
import { createModel } from "../pipeline/model.js"
import { createMemoryTools } from "../tools/memory.js"
import { createWebTools } from "../tools/web.js"

const SUBAGENT_MODEL = process.env.AGENT_PATH_MODEL || "claude-sonnet-4-6"
const NOTEPAD = join(homedir(), ".yomi")

// Spawn an isolated subagent for a subtask. Only the final text result is returned
// to the caller — the subagent's tool calls and intermediate reasoning are discarded.
export async function spawnSubagent(opts: {
  role: "researcher" | "writer" | "file-ops"
  task: string
  tools?: string[]        // subset of tool names; defaults to all available
  context?: string[]     // ~./yomi/ relative paths to preload into the system prompt
  maxIterations?: number
}): Promise<string> {
  const maxSteps = opts.maxIterations ?? 10
  const allTools = { ...createMemoryTools(), ...createWebTools() }

  const tools = opts.tools
    ? Object.fromEntries(Object.entries(allTools).filter(([k]) => opts.tools!.includes(k)))
    : allTools

  let contextText = ""
  if (opts.context?.length) {
    const parts = await Promise.allSettled(
      opts.context.map(p => readFile(join(NOTEPAD, p), "utf-8")),
    )
    contextText = parts
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map(r => r.value)
      .join("\n\n---\n\n")
  }

  const system = `You are a ${opts.role} subagent. Complete the assigned task and return a concise summary of what you did and found.${contextText ? `\n\n<context>\n${contextText}\n</context>` : ""}`

  const result = await generateText({
    model: createModel(SUBAGENT_MODEL),
    system,
    prompt: opts.task,
    tools,
    maxSteps,
  })

  return result.text
}
