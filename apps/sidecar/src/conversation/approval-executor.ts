import type { SseEvent } from "@yomi/shared"
import { ALL_CONNECTOR_DEFS } from "@yomi/agent-core"
import { getConversationState } from "./conversation-state.js"
import { isApprovalOrRejection } from "./types.js"
import { hooks } from "../harness/hooks.js"
import { getConnectorRegistry } from "../connectors/registry.js"
import { setActiveConversation } from "./active-conversation.js"

export interface ApprovalDeps {
  replayTool?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
}

type ExecutableTool = { execute?: (args: unknown, opts: unknown) => Promise<unknown> }

// Rebuilds the owning connector's tools WITHOUT createPendingAction so
// gateWrite() runs the real API call instead of re-queuing the approval.
// Mirrors apps/backend/src/services/pending-actions.ts replayConnectorTool.
async function replayConnectorTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const registry = getConnectorRegistry()
  const userId = registry.getUserId()
  if (!userId) throw new Error("No connected user — sign in and retry")
  const family = toolName.split("-")[0]
  const def = ALL_CONNECTOR_DEFS.find((d) => d.id === family || toolName.startsWith(`${d.id}-`))
  // Fall back to scanning every def for the exact tool key (gmail lives under "google").
  const defs = def ? [def] : ALL_CONNECTOR_DEFS
  for (const d of defs) {
    const tools = d.tools({ userId, getAccessToken: registry.getTokenProvider() }) as Record<
      string,
      ExecutableTool
    >
    const t = tools[toolName]
    if (t?.execute) return t.execute(args, { toolCallId: toolName, messages: [] })
  }
  // Family guess missed — scan everything before giving up.
  if (def) {
    for (const d of ALL_CONNECTOR_DEFS) {
      if (d === def) continue
      const tools = d.tools({ userId, getAccessToken: registry.getTokenProvider() }) as Record<
        string,
        ExecutableTool
      >
      const t = tools[toolName]
      if (t?.execute) return t.execute(args, { toolCallId: toolName, messages: [] })
    }
  }
  throw new Error(`No executor for tool ${toolName}`)
}

// Connector tools mostly don't throw — they return soft errors as either
// { error: "..." } or { ok: false, ... } (confirmed across github/gmail/slack/
// linear/notion defs). Treat both as failure so we don't report "Done" for
// something that didn't happen.
function isSoftError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null
  const r = result as Record<string, unknown>
  if (typeof r.error === "string" && r.error) return r.error
  if (r.ok === false) return (r.message as string) || "the connector reported failure"
  return null
}

function formatResult(toolName: string, title: string, result: unknown): string {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>
  const lines: string[] = [`Done: ${title}`]
  const push = (label: string, v: unknown) => {
    if (typeof v === "string" && v) lines.push(`${label}: ${v}`)
  }
  push("Link", (r.url ?? r.htmlLink ?? r.link ?? r.permalink) as string)
  push("Commit", r.commitSha as string)
  push("Branch", r.branch as string)
  push("Path", r.path as string)
  push("Title", (r.title ?? r.name ?? r.subject ?? r.summary) as string)
  push("When", (r.start ?? r.startTime) as string)
  push("Issue", r.identifier as string)
  if (typeof r.message === "string" && lines.length === 1) lines.push(r.message)
  return lines.join("\n")
}

export async function handleApprovalTurn(
  text: string,
  key: string,
  deps?: ApprovalDeps,
): Promise<SseEvent[] | null> {
  // Correct the process-global active-conversation here (not at each call
  // site) so replay's entity registration always lands in this turn's
  // conversation, even if another turn (e.g. Telegram) raced it in between.
  setActiveConversation(key)
  const decision = isApprovalOrRejection(text)
  if (!decision) return null

  const state = getConversationState(key)
  const pending = state.pendingActions.getLatest()
  if (!pending || pending.status !== "pending") return null

  if (decision === "reject") {
    state.pendingActions.reject(pending.id)
    state.persist()
    return [{ type: "agent_text", text: `Cancelled: ${pending.title}.` }, { type: "done" }]
  }

  state.pendingActions.approve(pending.id)
  state.pendingActions.startExecuting(pending.id)
  const replay = deps?.replayTool ?? replayConnectorTool
  const events: SseEvent[] = [
    { type: "agent_tool_call", tool: pending.toolName, args: pending.toolArguments },
  ]
  try {
    const pre = await hooks.onPreToolUse(pending.toolName, pending.toolArguments)
    if (!pre.ok) throw new Error(pre.reason ?? "blocked by guardrail")
    const raw = await replay(pending.toolName, pending.toolArguments)
    const result = await hooks.onPostToolUse(pending.toolName, raw, pending.toolArguments)
    const softError = isSoftError(result)
    if (softError) {
      state.pendingActions.fail(pending.id, softError)
      state.persist()
      events.push({ type: "agent_tool_result", tool: pending.toolName, result })
      events.push({ type: "agent_text", text: `Approved, but execution failed: ${softError}` })
      events.push({ type: "error", message: softError })
    } else {
      state.pendingActions.complete(pending.id, result)
      state.persist()
      events.push({ type: "agent_tool_result", tool: pending.toolName, result })
      events.push({
        type: "agent_text",
        text: formatResult(pending.toolName, pending.title, result),
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pendingActions.fail(pending.id, message)
    state.persist()
    events.push({ type: "agent_text", text: `Approved, but execution failed: ${message}` })
    events.push({ type: "error", message })
  }
  events.push({ type: "done" })
  return events
}
