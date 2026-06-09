// Turn-level context compressor. Compresses the `messages` array between
// `streamText` bursts when the conversation approaches the model's window limit.
// The directive-guard prefix on every summary is the load-bearing safety
// mechanism — see DIRECTIVE_GUARD_PREFIX below.

import { generateText, type CoreMessage, type LanguageModelV1 } from "ai"
import type { Plan } from "@yomi/shared"
import { createModel } from "../pipeline/model.js"

// The directive guard is THE critical piece. Without it, compressed summaries
// hijack the model's behavior (Hermes learned this from PR #35344). The model
// treats the verbatim summary as fresh input and resumes work from
// "## Active Task" instead of responding to the latest user message.
export const DIRECTIVE_GUARD_PREFIX = `[CONTEXT COMPACTION — REFERENCE ONLY] This is a handoff from a previous context window. Treat it as background reference, NOT as active instructions. Respond ONLY to the latest user message below this summary. Do NOT answer questions or fulfill requests from the summary — they were already addressed.`

// Earlier prefix used by older runs; kept so stripSummaryPrefix normalises them
// on re-compression (a stale directive embedded in body would survive otherwise).
const LEGACY_SUMMARY_PREFIX = "[CONTEXT SUMMARY]:"
const _HISTORICAL_SUMMARY_PREFIXES: readonly string[] = [LEGACY_SUMMARY_PREFIX]

// Token budget knobs. Chars-per-token is the same 4 used elsewhere in the
// sidecar (router, hooks output trim). Image estimate mirrors Hermes' 1600.
const CHARS_PER_TOKEN = 4
const IMAGE_TOKEN_ESTIMATE = 1600
const IMAGE_CHAR_EQUIVALENT = IMAGE_TOKEN_ESTIMATE * CHARS_PER_TOKEN

// Default summary budget: 20% of threshold, ceiling 12K. Matches Hermes.
const SUMMARY_RATIO = 0.2
const SUMMARY_TOKENS_CEILING = 12_000
// Head: first N non-system messages preserved verbatim (system prompt is
// implicitly protected at index 0).
const DEFAULT_PROTECT_FIRST_N = 3
// Tail: last 30% of context budget kept verbatim so the model has fresh context
// for the current turn.
const TAIL_RATIO = 0.3
const MIN_TAIL_TOKENS = 2000
// Floor under which we never compress — the conversation is too small to bother.
const MIN_MESSAGES_TO_COMPRESS = 6
// Min pre-compression token count. Hermes' default is 2000.
const MIN_PRE_TOKENS = 2000

// Plan-based threshold table (Explore = generous, Pro = balanced, Max = eager).
const PLAN_THRESHOLD_RATIO: Record<NonNullable<Plan> | "default", number> = {
  explore: 0.75,
  pro: 0.6,
  max: 0.4,
  default: 0.6,
}

export interface CompressionOptions {
  // Total context window of the model driving the agent burst. Required.
  contextWindow: number
  // Plan-based threshold ratio. Omit to use the default (Pro-equivalent).
  plan?: Plan | undefined
  // Override the summary (auxiliary) model. Defaults to gpt-4.1-mini.
  auxModelId?: string
  // Injectable model factory (default uses the sidecar's createModel).
  modelFactory?: (id: string) => LanguageModelV1
  // Optional focus topic — preserved in the summary prompt so the model
  // prioritises the active thread.
  focusTopic?: string
  // Abort signal threaded into the LLM call.
  signal?: AbortSignal
}

export interface CompressionResult {
  // The new (possibly compressed) message list. Always returned; equals the
  // input when compression is skipped or aborted.
  messages: CoreMessage[]
  // True when the messages were actually rewritten.
  compressed: boolean
  // Original vs final message counts.
  originalCount: number
  compressedCount: number
  // Estimated pre/post token counts.
  preTokens: number
  postTokens: number
  // Reason the call was a no-op (when compressed=false and there's something
  // useful to report back to the caller for telemetry).
  skipped?: "below_threshold" | "no_window" | "summary_failed" | "aborted"
  // Underlying error when skipped=summary_failed.
  error?: string
}

export function thresholdForPlan(plan: Plan | undefined, contextWindow: number): number {
  const ratio = PLAN_THRESHOLD_RATIO[plan ?? "default"]
  return Math.max(MIN_PRE_TOKENS, Math.floor(contextWindow * ratio))
}

// Extract the char-length of a message's content for token budgeting. Plain
// strings = len; multimodal lists sum text-part lengths plus a flat
// IMAGE_CHAR_EQUIVALENT per image part. Mirrors Hermes' _content_length_for_budget.
function messageCharLength(message: CoreMessage): number {
  const content = message.content
  if (typeof content === "string") return content.length
  if (!Array.isArray(content)) return String(content ?? "").length

  let total = 0
  for (const part of content as unknown[]) {
    if (typeof part === "string") {
      total += part.length
      continue
    }
    if (!part || typeof part !== "object") {
      total += String(part).length
      continue
    }
    const p = part as { type?: string; text?: string; result?: unknown }
    if (p.type === "image_url" || p.type === "input_image" || p.type === "image") {
      total += IMAGE_CHAR_EQUIVALENT
    } else if (p.type === "tool-result") {
      total += p.result === undefined ? 0 : safeStringify(p.result).length
    } else {
      total += (p.text ?? "").length
    }
  }
  return total
}

// Tool calls appear in two shapes:
//   AI SDK v4: assistant.content is an array; tool-call parts have args as an
//              object (or JSON string) keyed by toolCallId (camelCase).
//   Legacy / test fixtures: assistant.tool_calls is a separate array of
//              { tool_call_id, name, args: string } entries.
// Read both so the compressor is forgiving in the field.
interface ToolCallLike {
  id: string
  name: string
  args: string
}

function extractToolCalls(message: CoreMessage): ToolCallLike[] {
  if (message.role !== "assistant") return []
  const content = message.content
  if (Array.isArray(content)) {
    const calls: ToolCallLike[] = []
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const p = part as { type?: string; toolCallId?: string; toolName?: string; args?: unknown }
      if (p.type !== "tool-call") continue
      const id = p.toolCallId ?? ""
      const name = p.toolName ?? "unknown"
      const args = typeof p.args === "string" ? p.args : safeStringify(p.args)
      if (id) calls.push({ id, name, args })
    }
    return calls
  }
  const legacy = (message as { tool_calls?: unknown[] }).tool_calls
  if (Array.isArray(legacy)) {
    const calls: ToolCallLike[] = []
    for (const c of legacy) {
      if (!c || typeof c !== "object") continue
      const obj = c as {
        tool_call_id?: string
        id?: string
        name?: string
        toolName?: string
        args?: unknown
      }
      const id = obj.tool_call_id ?? obj.id ?? ""
      const name = obj.name ?? obj.toolName ?? "unknown"
      const args = typeof obj.args === "string" ? obj.args : safeStringify(obj.args)
      if (id) calls.push({ id, name, args })
    }
    return calls
  }
  return []
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  } catch {
    return String(value)
  }
}

function toolCallArgsLength(message: CoreMessage): number {
  let total = 0
  for (const c of extractToolCalls(message)) total += c.args.length
  return total
}

// Rough token estimate: chars/4 with a small per-message overhead for
// role/metadata. Includes tool-call argument length on assistant messages.
export function estimateMessagesTokens(messages: CoreMessage[]): number {
  let total = 0
  for (const m of messages) {
    const chars = messageCharLength(m) + toolCallArgsLength(m)
    total += Math.ceil(chars / CHARS_PER_TOKEN) + 4
  }
  return total
}

export function shouldCompress(
  messages: CoreMessage[],
  opts: { contextWindow: number; plan?: Plan | undefined },
): boolean {
  if (messages.length < MIN_MESSAGES_TO_COMPRESS) return false
  const tokens = estimateMessagesTokens(messages)
  const threshold = thresholdForPlan(opts.plan, opts.contextWindow)
  return tokens >= threshold
}

// Head: index of the first message that may be summarised. System prompt (if
// at index 0) plus DEFAULT_PROTECT_FIRST_N additional non-system messages.
function protectHeadSize(messages: CoreMessage[]): number {
  let head = 0
  if (messages.length > 0 && messages[0]?.role === "system") head = 1
  return head + DEFAULT_PROTECT_FIRST_N
}

// Walk the protected tail by token budget. The first message in the tail is
// the index where the middle (compressable) region ENDS.
function findTailCut(messages: CoreMessage[], headEnd: number, tailBudget: number): number {
  const n = messages.length
  if (n <= headEnd + 1) return n
  const minTail = 1
  let accumulated = 0
  let cutIdx = n
  for (let i = n - 1; i >= headEnd; i--) {
    const m = messages[i]
    if (!m) continue
    const tokens = Math.ceil(messageCharLength(m) / CHARS_PER_TOKEN) + 4
    if (accumulated + tokens > tailBudget && n - i > minTail) break
    accumulated += tokens
    cutIdx = i
  }
  return Math.max(cutIdx, headEnd + 1)
}

function isSummaryContent(content: unknown): boolean {
  if (typeof content !== "string") return false
  const text = content.trimStart()
  if (text.startsWith(DIRECTIVE_GUARD_PREFIX) || text.startsWith(LEGACY_SUMMARY_PREFIX)) {
    return true
  }
  return _HISTORICAL_SUMMARY_PREFIXES.some((p) => text.startsWith(p))
}

function stripSummaryPrefixInternal(text: string): string {
  const trimmed = (text ?? "").trimStart()
  if (trimmed.startsWith(DIRECTIVE_GUARD_PREFIX)) {
    return trimmed.slice(DIRECTIVE_GUARD_PREFIX.length).trimStart()
  }
  if (trimmed.startsWith(LEGACY_SUMMARY_PREFIX)) {
    return trimmed.slice(LEGACY_SUMMARY_PREFIX.length).trimStart()
  }
  for (const p of _HISTORICAL_SUMMARY_PREFIXES) {
    if (trimmed.startsWith(p)) return trimmed.slice(p.length).trimStart()
  }
  return trimmed
}

export function stripSummaryPrefix(text: string): string {
  return stripSummaryPrefixInternal(text)
}

export function withSummaryPrefix(body: string): string {
  const text = stripSummaryPrefixInternal(body)
  return `${DIRECTIVE_GUARD_PREFIX}\n\n${text}`
}

// Walk the protected tail by token budget. The first message in the tail is
// the index where the middle (compressable) region ENDS.

// Symmetric to Hermes' _align_boundary_forward: slide past consecutive tool
// results so we never start the compress region mid-tool-group.
function alignForward(messages: CoreMessage[], idx: number): number {
  let i = idx
  while (i < messages.length && messages[i]?.role === "tool") i++
  return i
}

// Symmetric to Hermes' _align_boundary_backward: pull boundary back to keep an
// assistant+tool_calls group intact.
function alignBackward(messages: CoreMessage[], idx: number): number {
  if (idx <= 0 || idx >= messages.length) return idx
  let check = idx - 1
  while (check >= 0 && messages[check]?.role === "tool") check--
  if (check >= 0 && messages[check]?.role === "assistant") {
    if (extractToolCalls(messages[check] as CoreMessage).length > 0) idx = check
  }
  return idx
}

// Cheap pre-pass: prune tool result bodies outside the protected tail with
// informative 1-line summaries. No LLM call. Symmetric to Hermes'
// _prune_old_tool_results. Works on both v4 (content array) and legacy
// (string content + tool_call_id) shapes.
function pruneOldToolResults(
  messages: CoreMessage[],
  pruneBoundary: number,
): { messages: CoreMessage[]; pruned: number } {
  if (pruneBoundary >= messages.length) return { messages, pruned: 0 }
  const result: CoreMessage[] = []
  let pruned = 0
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m) continue
    if (i >= pruneBoundary) {
      result.push(m)
      continue
    }
    if (m.role !== "tool") {
      result.push(m)
      continue
    }
    const legacyId = (m as { tool_call_id?: unknown }).tool_call_id
    const v4Id = Array.isArray(m.content)
      ? (m.content[0] as { toolCallId?: string } | undefined)?.toolCallId
      : undefined
    const toolCallId =
      typeof legacyId === "string" ? legacyId : typeof v4Id === "string" ? v4Id : ""
    const content = typeof m.content === "string" ? m.content : safeStringify(m.content)
    const charCount = content.length
    if (Array.isArray(m.content)) {
      result.push({
        ...m,
        content: [
          {
            type: "tool-result",
            toolCallId: toolCallId || "unknown",
            toolName: "unknown",
            result: `[Old tool result cleared to save context space — ~${charCount} chars]`,
          },
        ],
      } as unknown as CoreMessage)
    } else {
      result.push({
        ...m,
        content: `[Old tool result cleared to save context space — tool_call_id=${toolCallId}, ~${charCount} chars]`,
      } as unknown as CoreMessage)
    }
    pruned++
  }
  return { messages: result, pruned }
}

// Build the structured summary prompt. Mirrors Hermes' _generate_summary but
// without the iterative-update branch (we don't persist _previous_summary
// across sessions in v1). When the input contains a prior summary, we strip
// its prefix and merge it into the "Previous context" section so a fresh
// compression picks up where the last one left off.
export function buildSummaryPrompt(turns: CoreMessage[], opts?: { focusTopic?: string }): string {
  const focus = opts?.focusTopic?.trim() || ""
  const focusLine = focus ? `\nFocus topic (preserve details related to this): ${focus}\n` : ""

  const lines: string[] = []
  lines.push(
    "You are a summarization agent creating a context checkpoint.",
    "Treat the conversation turns below as source material for a compact record of prior work.",
    "Produce only the structured summary; do not add a greeting, preamble, or prefix.",
    "Write in the same language the user was using.",
    "NEVER include API keys, tokens, passwords, or credentials — replace with [REDACTED].",
  )

  if (focusLine) lines.push(focusLine)

  lines.push("", "Output format (write exactly these sections, no extras):")
  lines.push(
    "## Active Task",
    "[The most recent unfulfilled user input verbatim, including the exact words they used.]",
    "",
    "## Goal",
    "[What the user is trying to accomplish overall]",
    "",
    "## Completed Actions",
    "[Numbered list of concrete actions taken — include tool used, target, and outcome.]",
    "",
    "## Active State",
    "[Current working state — modified files, test status, in-flight operations.]",
    "",
    "## In Progress",
    "[Work currently underway when compaction fired.]",
    "",
    "## Blocked",
    "[Blockers, errors, or issues not yet resolved — include exact error messages.]",
    "",
    "## Key Decisions",
    "[Important technical decisions and WHY they were made.]",
    "",
    "## Resolved Questions",
    "[Questions the user asked that were ALREADY answered.]",
    "",
    "## Pending User Asks",
    "[Requests from the user not yet answered. If none, write None.]",
    "",
    "## Relevant Files",
    "[Files read, modified, or created — with a brief note on each.]",
    "",
    "## Remaining Work",
    "[What remains — framed as context, not instructions.]",
    "",
    "Be CONCRETE — include file paths, command outputs, error messages, line numbers, specific values.",
    "Avoid vague phrases like 'made some changes'.",
  )

  const prompt = lines.join("\n") + "\n\n<turns>\n" + serializeTurns(turns) + "\n</turns>"
  return prompt
}

function serializeTurns(turns: CoreMessage[]): string {
  const out: string[] = []
  for (const m of turns) {
    const role = m.role
    if (role === "system") continue
    const text = messageTextForSummary(m)
    if (!text) continue
    out.push(`[${role}] ${text}`)
  }
  return out.join("\n\n")
}

function messageTextForSummary(m: CoreMessage): string {
  const content = m.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const p of content) {
    if (typeof p === "string") {
      parts.push(p)
      continue
    }
    if (!p || typeof p !== "object") continue
    const obj = p as { type?: string; text?: string; result?: unknown }
    if (obj.type === "image_url" || obj.type === "input_image" || obj.type === "image") {
      parts.push("[image]")
    } else if (obj.type === "tool-result") {
      const r = obj.result
      parts.push(typeof r === "string" ? r : safeStringify(r))
    } else if (typeof obj.text === "string") {
      parts.push(obj.text)
    }
  }
  return parts.join(" ").trim()
}

// Insert a summary message between head and tail, picking a role that
// doesn't violate OpenAI's role-alternation. The summary text already starts
// with DIRECTIVE_GUARD_PREFIX.
function insertSummary(head: CoreMessage[], tail: CoreMessage[], summary: string): CoreMessage[] {
  const lastHeadRole = head[head.length - 1]?.role
  const firstTailRole = tail[0]?.role
  let summaryRole: "user" | "assistant" = "user"
  if (lastHeadRole === "assistant" || lastHeadRole === "tool") summaryRole = "user"
  else summaryRole = "assistant"
  if (summaryRole === firstTailRole) {
    const flipped = summaryRole === "user" ? "assistant" : "user"
    if (flipped !== lastHeadRole) summaryRole = flipped
  }
  return [...head, { role: summaryRole, content: summary } as CoreMessage, ...tail]
}

// Extract the tool_call_id from a tool message in either shape. Returns "" if
// the message isn't a tool message or has no id.
function toolMessageCallId(message: CoreMessage): string {
  if (message.role !== "tool") return ""
  const legacy = (message as { tool_call_id?: unknown }).tool_call_id
  if (typeof legacy === "string" && legacy) return legacy
  const content = message.content
  if (Array.isArray(content) && content[0] && typeof content[0] === "object") {
    const p = content[0] as { toolCallId?: unknown }
    if (typeof p.toolCallId === "string" && p.toolCallId) return p.toolCallId
  }
  return ""
}

// Drop orphaned tool results / insert stubs for orphaned tool_calls so the
// API never sees mismatched tool_call_ids. Mirrors Hermes' _sanitize_tool_pairs.
function sanitizeToolPairs(messages: CoreMessage[]): CoreMessage[] {
  const survivingCallIds = new Set<string>()
  for (const m of messages) {
    if (m.role !== "assistant") continue
    for (const c of extractToolCalls(m)) survivingCallIds.add(c.id)
  }
  const resultCallIds = new Set<string>()
  for (const m of messages) {
    const id = toolMessageCallId(m)
    if (id) resultCallIds.add(id)
  }

  const orphans = new Set<string>()
  for (const id of resultCallIds) if (!survivingCallIds.has(id)) orphans.add(id)
  const missing = new Set<string>()
  for (const id of survivingCallIds) if (!resultCallIds.has(id)) missing.add(id)

  if (orphans.size === 0 && missing.size === 0) return messages

  const filtered = messages.filter((m) => {
    if (m.role !== "tool") return true
    const id = toolMessageCallId(m)
    return !(id && orphans.has(id))
  })

  if (missing.size === 0) return filtered

  const stubbed: CoreMessage[] = []
  for (const m of filtered) {
    stubbed.push(m)
    if (m.role !== "assistant") continue
    for (const c of extractToolCalls(m)) {
      if (missing.has(c.id)) {
        stubbed.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: c.id,
              toolName: c.name,
              result: "[Result from earlier conversation — see context summary above]",
            },
          ],
        } as unknown as CoreMessage)
      }
    }
  }
  return stubbed
}

export async function compressContext(
  messages: CoreMessage[],
  opts: CompressionOptions,
): Promise<CompressionResult> {
  const originalCount = messages.length
  const preTokens = estimateMessagesTokens(messages)
  const threshold = thresholdForPlan(opts.plan, opts.contextWindow)

  if (preTokens < threshold) {
    return {
      messages,
      compressed: false,
      originalCount,
      compressedCount: originalCount,
      preTokens,
      postTokens: preTokens,
      skipped: "below_threshold",
    }
  }

  const headEnd = protectHeadSize(messages)
  const tailBudget = Math.max(MIN_TAIL_TOKENS, Math.floor(opts.contextWindow * TAIL_RATIO))
  let tailCut = findTailCut(messages, headEnd, tailBudget)
  tailCut = alignForward(messages, tailCut)
  tailCut = alignBackward(messages, tailCut)
  tailCut = Math.max(tailCut, headEnd + 1)

  if (tailCut <= headEnd) {
    return {
      messages,
      compressed: false,
      originalCount,
      compressedCount: originalCount,
      preTokens,
      postTokens: preTokens,
      skipped: "no_window",
    }
  }

  // Cheap pre-pass: prune old tool result bodies outside the tail. Builds the
  // region we'll send to the LLM summarizer.
  const { messages: pruned } = pruneOldToolResults(messages, tailCut)
  const turns = pruned.slice(headEnd, tailCut)

  // If a prior summary sits in the protected head, lift its body so the new
  // summary can merge into it. We don't persist the previous summary across
  // sessions in v1; the merge only kicks in when the head already contains a
  // summary (e.g. a re-compression in the same run).
  let previousSummary = ""
  for (let i = 1; i < headEnd; i++) {
    const m = pruned[i]
    if (!m) continue
    const content = m.content
    if (typeof content === "string" && isSummaryContent(content)) {
      previousSummary = stripSummaryPrefixInternal(content)
      break
    }
  }

  const auxModelId = opts.auxModelId ?? process.env["COMPRESSOR_MODEL"] ?? "gpt-4.1-mini"
  const factory = opts.modelFactory ?? createModel
  const model = factory(auxModelId)
  if (!model) {
    return {
      messages,
      compressed: false,
      originalCount,
      compressedCount: originalCount,
      preTokens,
      postTokens: preTokens,
      skipped: "summary_failed",
      error: "aux model factory returned no model",
    }
  }

  const prompt = buildSummaryPrompt(turns, { focusTopic: opts.focusTopic })
  const summaryBudget = Math.min(Math.floor(opts.contextWindow * 0.05), SUMMARY_TOKENS_CEILING)
  const systemLines = [
    "You create compact context checkpoints for an AI assistant.",
    previousSummary
      ? `Merge new turns into the previous checkpoint below — preserve the structure, fold in new work.\n\n<previous_checkpoint>\n${previousSummary}\n</previous_checkpoint>`
      : "Write a fresh structured checkpoint for the turns provided.",
    `Target ~${Math.floor(summaryBudget * SUMMARY_RATIO)} tokens.`,
  ].join("\n\n")

  let summaryBody = ""
  try {
    const { text } = await generateText({
      model,
      system: systemLines,
      prompt,
      abortSignal: opts.signal,
    })
    summaryBody = text.trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      messages,
      compressed: false,
      originalCount,
      compressedCount: originalCount,
      preTokens,
      postTokens: preTokens,
      skipped: "summary_failed",
      error: msg,
    }
  }

  if (!summaryBody) {
    return {
      messages,
      compressed: false,
      originalCount,
      compressedCount: originalCount,
      preTokens,
      postTokens: preTokens,
      skipped: "summary_failed",
      error: "empty summary",
    }
  }

  const head = messages.slice(0, headEnd).map((m) => ({ ...m }))
  const tail = messages.slice(tailCut).map((m) => ({ ...m }))
  const merged = insertSummary(head, tail, withSummaryPrefix(summaryBody))
  const compressed = sanitizeToolPairs(merged)
  const postTokens = estimateMessagesTokens(compressed)

  return {
    messages: compressed,
    compressed: compressed.length < originalCount,
    originalCount,
    compressedCount: compressed.length,
    preTokens,
    postTokens,
  }
}
