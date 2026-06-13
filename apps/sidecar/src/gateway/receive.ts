import type { GatewayMessage, SseEvent } from "@yomi/shared"
import { classifyIntent } from "../router/intent.js"
import { fastPipeline } from "../pipeline/fast.js"
import { agentPipeline } from "../pipeline/agent.js"

const BACKEND_URL = process.env.YOMI_BACKEND_URL ?? process.env.BACKEND_URL ?? "http://localhost:3001"

let polling = false
let pollTimer: ReturnType<typeof setInterval> | null = null

export function startGatewayPoll(): void {
  if (!process.env.YOMI_SESSION_TOKEN) {
    console.warn("[gateway/poll] no YOMI_SESSION_TOKEN — skipping poll")
    return
  }
  // Backend now handles gateway messages server-side — skip the sidecar poll
  // to prevent dual-delivery when YOMI_GATEWAY_BACKEND=1.
  if (process.env.YOMI_GATEWAY_BACKEND === "1") {
    console.warn("[gateway/poll] backend handles gateway — sidecar poll disabled")
    return
  }
  if (polling) return
  polling = true
  console.warn("[gateway/poll] started")
  poll()
  pollTimer = setInterval(poll, 2_000)
}

export function stopGatewayPoll(): void {
  polling = false
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  console.warn("[gateway/poll] stopped")
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/gateway/pending`, {
      headers: { Authorization: `Bearer ${process.env.YOMI_SESSION_TOKEN}` },
    })
    if (!res.ok) return
    const data = (await res.json()) as { messages: GatewayMessage[] }
    if (!data.messages?.length) return
    for (const msg of data.messages) {
      await handleGatewayMessage(msg)
    }
  } catch (err) {
    console.warn("[gateway/poll] error:", err instanceof Error ? err.message : String(err))
  }
}

export async function handleGatewayMessage(msg: GatewayMessage): Promise<void> {
  const intent = await classifyIntent({ text: msg.text })
  const sseEmitter = {
    emit(event: SseEvent) {
      if (event.type === "agent_text") {
        sendReply(msg.platform, msg.chatId, event.text)
      }
    },
  }
  if (intent.path === "fast") {
    for await (const event of fastPipeline({ text: msg.text })) {
      if (event.type === "llm_chunk") {
        sendReply(msg.platform, msg.chatId, event.text)
      }
    }
  } else {
    for await (const event of agentPipeline(
      { text: msg.text, plan: "max" },
      { emit: (e) => sseEmitter.emit(e) },
    )) {
      if (event.type === "agent_text") {
        sendReply(msg.platform, msg.chatId, event.text)
      }
    }
  }
}

async function sendReply(platform: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/gateway/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.YOMI_SESSION_TOKEN}`,
      },
      body: JSON.stringify({ platform, chatId, text }),
    })
  } catch (err) {
    console.warn("[gateway/send] error:", err instanceof Error ? err.message : String(err))
  }
}
