import type { AgentQueryRequest, GatewayMessage, Plan, PlatformType, SseEvent } from "@yomi/shared"
import { classifyIntent } from "../router/intent.js"
import { fastPipeline } from "../pipeline/fast.js"
import { agentPipeline } from "../pipeline/agent.js"

const BACKEND_URL = process.env["YOMI_BACKEND_URL"] ?? "http://localhost:3001"
const PLAN = (process.env["YOMI_PLAN"] ?? "max") as Plan
const POLL_INTERVAL_MS = 2_500
const SESSION_TOKEN = process.env["YOMI_SESSION_TOKEN"] ?? ""

let pollTimer: ReturnType<typeof setInterval> | null = null

// Start polling the backend for pending gateway messages
export function startGatewayPoll(): void {
  if (pollTimer) return
  if (!SESSION_TOKEN) {
    console.warn("[gateway/poll] no YOMI_SESSION_TOKEN — skipping poll")
    return
  }

  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS)
  console.warn("[gateway/poll] started")
}

export function stopGatewayPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
    console.warn("[gateway/poll] stopped")
  }
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/gateway/pending`, {
      headers: {
        Authorization: `Bearer ${SESSION_TOKEN}`,
      },
    })
    if (!res.ok) return
    const data = (await res.json()) as { messages: GatewayMessage[] }
    if (!data.messages?.length) return

    console.warn(`[gateway/poll] received ${data.messages.length} message(s)`)
    for (const msg of data.messages) {
      void handleGatewayMessage(msg)
    }
  } catch {
    // retry on next interval
  }
}

export async function handleGatewayMessage(msg: GatewayMessage): Promise<void> {
  const decision = await classifyIntent({ text: msg.text })
  console.warn(`[gateway/receive] ${msg.platform}: ${decision.path} path`)

  let responseText = ""

  if (decision.path === "agent") {
    responseText = await runAgentPath(msg.text)
  } else {
    responseText = await runFastPath(msg.text)
  }

  if (responseText) {
    await sendReply(msg.platform, msg.chatId, responseText, msg.messageId)
  }
}

async function runFastPath(text: string): Promise<string> {
  try {
    const collector: string[] = []
    for await (const event of fastPipeline(
      { text, plan: PLAN },
      new AbortController().signal,
    )) {
      if (event.type === "llm_chunk") {
        collector.push(event.text)
      }
    }
    return collector.join("")
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn(`[gateway/receive] fast pipeline error: ${errMsg}`)
    return `Sorry, I encountered an error: ${errMsg}`
  }
}

async function runAgentPath(text: string): Promise<string> {
  try {
    const req: AgentQueryRequest = { text, plan: PLAN }
    let driver = agentPipeline as (r: AgentQueryRequest, o?: object) => AsyncGenerator<SseEvent>
    if (process.env["YOMI_LEGACY_AGENT"] !== "1") {
      const { runGraph } = await import("../graph/run.js")
      driver = runGraph as typeof driver
    }
    const collector: string[] = []
    for await (const event of driver(req)) {
      if (event.type === "agent_text") {
        collector.push(event.text)
      }
    }
    return collector.join("")
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn(`[gateway/receive] agent pipeline error: ${errMsg}`)
    return `Sorry, I encountered an error: ${errMsg}`
  }
}

async function sendReply(
  platform: PlatformType,
  chatId: string,
  text: string,
  replyTo?: string,
): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/gateway/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, chatId, text, replyTo }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown")
      console.warn(`[gateway/receive] backend send failed (${res.status}): ${errText}`)
    }
  } catch (err) {
    console.warn(`[gateway/receive] backend send error:`, err)
  }
}
