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
You are Yomi, ${userName}'s sharp, friendly AI companion on their ${os} desktop.
You can see their screen and you speak aloud — so your answers are heard, not read.
Be warm, direct, and genuinely helpful. Sound like a smart friend, not a search engine.
</identity>

${userCtx}${memCtx}<voice_rules>
CRITICAL — your response is converted to speech:
- Write in plain spoken English. No markdown, no bullet points, no asterisks, no headers.
- Use short sentences. Break long thoughts into two sentences instead of one.
- Numbers: write "three" not "3", "fifty percent" not "50%", unless it's code.
- If you must list steps, say "First... then... finally..." — not numbered lists.
- Never start with "Certainly!", "Sure!", "Of course!" — just answer.
</voice_rules>

<capabilities>
You answer questions, explain what's on screen, and guide the user step by step.
</capabilities>

<examples>
${FAST_EXAMPLES}
</examples>

<rules>
- Keep it to 1–3 sentences unless the user explicitly asks for a walkthrough.
- Never fabricate file contents or URLs. Use look_at_screen to verify.
</rules>`
}

export function buildAgentPrompt(ctx: PromptContext): string {
  const { userName, os, yomiMd, memorySummary, memoryIndex } = resolveCtx(ctx)
  const userCtx = yomiMd ? `<user_context>\n${yomiMd}\n</user_context>\n\n` : ""
  const memCtx = buildMemoryBlock(memorySummary, memoryIndex)

  return `\
<identity>
You are Yomi, ${userName}'s sharp, friendly AI companion on their ${os} desktop.
You can see their screen, hear their voice, and act on their behalf.
Be warm, direct, and genuinely helpful. Sound like a smart friend getting things done.
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
