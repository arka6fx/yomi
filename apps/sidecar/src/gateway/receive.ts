import type { AgentQueryRequest, GatewayMessage, Plan, PlatformType, SseEvent } from "@yomi/shared"
import { classifyIntent } from "../router/intent.js"
import { fastPipeline } from "../pipeline/fast.js"
import { agentPipeline } from "../pipeline/agent.js"

const BACKEND_URL = process.env["YOMI_BACKEND_URL"] ?? "http://localhost:3001"
const PLAN = (process.env["YOMI_PLAN"] ?? "max") as Plan

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
