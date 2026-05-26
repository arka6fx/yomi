import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadMemorySummary, loadMemoryIndex } from "../memory/loader.js"
import { readProfile, retrieveLocalMemoryContext } from "../memory/engine.js"
import { retrieveCloudRagContext } from "../memory/cloud-rag.js"

const MAX_MEMORY_SUMMARY_CHARS = 4000
const MAX_MEMORY_INDEX_CHARS = 2000

export interface PromptContext {
  userName?: string
  os?: string
  yomiMd?: string
  memorySummary?: string
  memoryIndex?: string
  localMemory?: string
  cloudRagContext?: string
  staticProfile?: string
  dynamicProfile?: string
  recentSession?: string
  hasScreen?: boolean  // whether a screenshot is attached to this turn
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
  return {
    memorySummary: memorySummary.slice(0, MAX_MEMORY_SUMMARY_CHARS),
    memoryIndex: memoryIndex.slice(0, MAX_MEMORY_INDEX_CHARS),
  }
}

export async function loadRichMemoryContext(query: string): Promise<{
  memorySummary: string
  memoryIndex: string
  localMemory: string
  cloudRagContext: string
  staticProfile: string
  dynamicProfile: string
}> {
  const [base, localMemory, cloudRagContext, staticProfile, dynamicProfile] = await Promise.all([
    loadMemoryContext(),
    Promise.resolve(retrieveLocalMemoryContext(query, 3000)),
    retrieveCloudRagContext(query, 3000),
    readProfile("static"),
    readProfile("dynamic"),
  ])
  return { ...base, localMemory, cloudRagContext, staticProfile, dynamicProfile }
}

// Resolve userName and os from env/process when not supplied by caller.
function resolveCtx(ctx: PromptContext): Required<PromptContext> {
  return {
    userName: ctx.userName ?? process.env.USER ?? "user",
    os: ctx.os ?? process.platform,
    yomiMd: ctx.yomiMd ?? "",
    memorySummary: ctx.memorySummary ?? "",
    memoryIndex: ctx.memoryIndex ?? "",
    localMemory: ctx.localMemory ?? "",
    cloudRagContext: ctx.cloudRagContext ?? "",
    staticProfile: ctx.staticProfile ?? "",
    dynamicProfile: ctx.dynamicProfile ?? "",
    recentSession: ctx.recentSession ?? "",
    hasScreen: ctx.hasScreen ?? false,
  }
}

function buildMemoryBlock(ctx: Pick<Required<PromptContext>, "memorySummary" | "memoryIndex" | "localMemory" | "cloudRagContext" | "staticProfile" | "dynamicProfile" | "recentSession">): string {
  if (!ctx.memorySummary && !ctx.memoryIndex && !ctx.localMemory && !ctx.cloudRagContext && !ctx.staticProfile && !ctx.dynamicProfile && !ctx.recentSession) return ""
  const parts: string[] = []
  if (ctx.staticProfile) parts.push(`<static_profile>\n${ctx.staticProfile.trim()}\n</static_profile>`)
  if (ctx.dynamicProfile) parts.push(`<dynamic_profile>\n${ctx.dynamicProfile.trim()}\n</dynamic_profile>`)
  if (ctx.memoryIndex) parts.push(`<index>\n${ctx.memoryIndex.trim()}\n</index>`)
  if (ctx.memorySummary) parts.push(`<summary>\n${ctx.memorySummary.trim()}\n</summary>`)
  if (ctx.localMemory) parts.push(`<local_retrieved>\n${ctx.localMemory.trim()}\n</local_retrieved>`)
  if (ctx.cloudRagContext) parts.push(`<cloud_rag_context>\n${ctx.cloudRagContext.trim()}\n</cloud_rag_context>`)
  if (ctx.recentSession) parts.push(`<recent_chat>\n${ctx.recentSession.trim()}\n</recent_chat>`)
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

const ANSWER_FORMAT_RULES = `\
<answer_format>
Always separate the actual answer from explanation so the app can render it clearly.

For coding or algorithm problems:
- Start with a short introduction to the problem and approach.
- Then provide the complete solution in one fenced code block using the requested or visible language. Default to Python if no language is clear.
- Then include "Time: O(...)" and "Space: O(...)" with one-line reasons.
- Add one or two examples when useful, especially examples visible on the screen.

For MCQ or single definite-answer questions:
- Explain the reason first in one to three sentences.
- Then render only the final choice in this exact block:
\`\`\`answer
[letter and answer text]
\`\`\`

For writing tasks, such as an email, leave application, message, essay, or draft:
- Briefly say what you drafted.
- Then put the exact copy-ready deliverable in this exact block:
\`\`\`answer
[the actual written answer]
\`\`\`
- Format applications and letters properly with date, recipient, subject, salutation, clear paragraphs, closing, and sender name when appropriate.
- Format biographies and long explanations with a title, short sections, readable paragraphs, and bullets only where they improve scanning.
- Do not compress long-form writing into a tiny answer. Make it complete, but avoid padding.

For ordinary questions:
- Give a brief reason or context first.
- Then put the direct final answer in an answer block when there is a concrete answer to copy, choose, or act on.
</answer_format>`

export function buildFastPrompt(ctx: PromptContext): string {
  const { userName, os, yomiMd, hasScreen, ...memoryCtx } = resolveCtx(ctx)
  const userCtx = yomiMd ? `<user_context>\n${yomiMd}\n</user_context>\n\n` : ""
  const memCtx = buildMemoryBlock(memoryCtx)

  const screenLine = hasScreen
    ? "A screenshot of their current screen is attached — use it to answer."
    : "No screenshot is attached this turn — answer from your own knowledge."

  const capLine = hasScreen
    ? "You answer questions, explain what's on screen, and guide the user step by step."
    : "You answer questions and help the user step by step. Do not reference any image or screen."

  return `\
<identity>
You are Yomi, ${userName}'s sharp, friendly AI companion on their ${os} desktop.
You speak aloud — so your answers are heard, not read.
Be warm, direct, and genuinely helpful. Sound like a smart friend, not a search engine.
</identity>

<screen_context>
${screenLine}
</screen_context>

${userCtx}${memCtx}${ANSWER_FORMAT_RULES}

<voice_rules>
CRITICAL — your response is converted to speech:
- Keep explanation in plain spoken English outside fenced blocks.
- Use fenced answer/code blocks exactly when the answer format rules require them.
- Avoid decorative markdown, bullet-heavy formatting, asterisks, and headers.
- Use short sentences. Break long thoughts into two sentences instead of one.
- Numbers: write "three" not "3", "fifty percent" not "50%", unless it's code.
- If you must list steps, say "First... then... finally..." — not numbered lists.
- Never start with "Certainly!", "Sure!", "Of course!" — just answer.
</voice_rules>

<capabilities>
${capLine}
</capabilities>

<examples>
${FAST_EXAMPLES}
</examples>

<rules>
- Keep it to 1–3 sentences unless the user asks for code, an application, a biography, a draft, or a walkthrough.
- Never fabricate file contents or URLs. Use look_at_screen to verify.
</rules>`
}

export function buildAgentPrompt(ctx: PromptContext): string {
  const { userName, os, yomiMd, ...memoryCtx } = resolveCtx(ctx)
  const userCtx = yomiMd ? `<user_context>\n${yomiMd}\n</user_context>\n\n` : ""
  const memCtx = buildMemoryBlock(memoryCtx)

  return `\
<identity>
You are Yomi, ${userName}'s sharp, friendly AI companion on their ${os} desktop.
You can see their screen, hear their voice, and act on their behalf.
Be warm, direct, and genuinely helpful. Sound like a smart friend getting things done.
</identity>

${userCtx}${memCtx}${ANSWER_FORMAT_RULES}

<capabilities>
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
