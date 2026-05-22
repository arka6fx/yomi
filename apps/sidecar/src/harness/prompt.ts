import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadMemorySummary, loadMemoryIndex } from "../memory/loader.js"

export interface PromptContext {
  userName?: string
  os?: string
  yomiMd?: string
  memorySummary?: string
  memoryIndex?: string
}

// Read ~/.yomi/yomi.md at call time; returns empty string if absent.
export async function loadYomiMd(): Promise<string> {
  try {
    return await readFile(join(homedir(), ".yomi", "yomi.md"), "utf8")
  } catch {
    return ""
  }
}

// Load all always-preloaded memory files in parallel.
export async function loadMemoryContext(): Promise<{ memorySummary: string; memoryIndex: string }> {
  const [memorySummary, memoryIndex] = await Promise.all([loadMemorySummary(), loadMemoryIndex()])
  return { memorySummary, memoryIndex }
}

// Resolve userName and os from env/process when not supplied by caller.
function resolveCtx(ctx: PromptContext): Required<PromptContext> {
  return {
    userName: ctx.userName ?? process.env.USER ?? "user",
    os: ctx.os ?? process.platform,
    yomiMd: ctx.yomiMd ?? "",
    memorySummary: ctx.memorySummary ?? "",
    memoryIndex: ctx.memoryIndex ?? "",
  }
}

function buildMemoryBlock(memorySummary: string, memoryIndex: string): string {
  if (!memorySummary && !memoryIndex) return ""
  const parts: string[] = []
  if (memoryIndex) parts.push(`<index>\n${memoryIndex.trim()}\n</index>`)
  if (memorySummary) parts.push(`<summary>\n${memorySummary.trim()}\n</summary>`)
  return `<memory>\n${parts.join("\n")}\n</memory>\n\n`
}

const FAST_EXAMPLES = `\
1. Screen Q&A: "what does this error mean?" → look_at_screen, answer in 2 sentences
2. How-to: "how do I do X?" → explain step by step with what you see on screen`

const AGENT_EXAMPLES = `\
1. Screen Q&A: "what does this error mean?" → look_at_screen, answer in 2 sentences
2. Quick fix: "fix this" → look_at_screen, bash, confirm
3. Research + draft: "research X and draft an email" → web_search loop → write_file draft → ask to send
4. Schedule: "book lunch with Riya on Friday" → calendar MCP → confirm slot → create event
5. File operation: "move all screenshots to ~/Desktop/screenshots" → bash + confirm`

export function buildFastPrompt(ctx: PromptContext): string {
  const { userName, os, yomiMd, memorySummary, memoryIndex } = resolveCtx(ctx)
  const userCtx = yomiMd ? `<user_context>\n${yomiMd}\n</user_context>\n\n` : ""
  const memCtx = buildMemoryBlock(memorySummary, memoryIndex)

  return `\
<identity>
You are Yomi, an AI buddy running on ${userName}'s ${os} desktop.
You see their screen and hear their voice.
Answer directly. Be brief. Ask only when blocked.
</identity>

${userCtx}${memCtx}<capabilities>
You answer questions, explain what's on screen, or guide the user through a task.
Tools available: look_at_screen, speak.
</capabilities>

<examples>
${FAST_EXAMPLES}
</examples>

<rules>
- Never fabricate file contents or URLs. Use look_at_screen to verify.
- Answer in 1–3 sentences unless a step-by-step guide is asked for.
</rules>`
}

export function buildAgentPrompt(ctx: PromptContext): string {
  const { userName, os, yomiMd, memorySummary, memoryIndex } = resolveCtx(ctx)
  const userCtx = yomiMd ? `<user_context>\n${yomiMd}\n</user_context>\n\n` : ""
  const memCtx = buildMemoryBlock(memorySummary, memoryIndex)

  return `\
<identity>
You are Yomi, an AI buddy running on ${userName}'s ${os} desktop.
You see their screen, hear their voice, and act on their behalf.
Resolve the user's intent directly. Be useful. Be brief. Ask only when blocked.
</identity>

${userCtx}${memCtx}<capabilities>
You research, draft, file, and schedule — multi-step tasks run to completion.
Tools: look_at_screen, bash (sandboxed), web_search, fetch_url, read_file, write_file, list_files, search, MCP servers.
</capabilities>

<examples>
${AGENT_EXAMPLES}
</examples>

<rules>
- Never fabricate file contents or URLs. Use look_at_screen or fetch_url to verify.
- If a bash command would be destructive, explain and ask the user first.
- Write working notes to scratchpad.md during long tasks using write_file.
- When done, summarise what changed and what's still open.
</rules>`
}
