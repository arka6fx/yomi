import type { AgentQueryRequest, GatewayMessage, SseEvent } from "@yomi/shared"
import { classifyIntent } from "../router/intent.js"
import { fastPipeline } from "../pipeline/fast.js"
import { agentPipeline } from "../pipeline/agent.js"
import { initConnectorRegistry } from "../connectors/registry.js"
import { enqueueTrigger } from "./remote-queue.js"

type AgentDriver = (
  req: AgentQueryRequest,
  opts?: { emit?: (e: SseEvent) => void; signal?: AbortSignal },
) => AsyncGenerator<SseEvent>

async function getAgentDriver(): Promise<AgentDriver> {
  if (process.env.YOMI_LEGACY_AGENT === "1") return agentPipeline as AgentDriver
  const { runGraph } = await import("../graph/run.js")
  return runGraph as AgentDriver
}

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
  const text = msg.text.trim()

  // ── Remote desktop triggers ──────────────────────────────────────────────
  // These commands are dispatched to the desktop via the remote-queue and
  // resolved once the desktop posts the result back to /remote/result.

  if (text === "/screenshot") {
    try {
      const result = await enqueueTrigger("screenshot")
      await sendReply(msg.platform, msg.chatId, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Screenshot failed"
      await sendReply(msg.platform, msg.chatId, `⚠️ ${message}`)
    }
    return
  }

  if (text === "/voice") {
    try {
      await enqueueTrigger("voice")
      await sendReply(msg.platform, msg.chatId, "🎙️ Voice mode started on your desktop.")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Voice trigger failed"
      await sendReply(msg.platform, msg.chatId, `⚠️ ${message}`)
    }
    return
  }

  const moveMatch = /^\/move\s+(left|right|up|down)$/i.exec(text)
  if (moveMatch) {
    const direction = moveMatch[1]!.toLowerCase()
    try {
      await enqueueTrigger("move", { direction })
      await sendReply(msg.platform, msg.chatId, `↕ Yomi window nudged ${direction}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Move failed"
      await sendReply(msg.platform, msg.chatId, `⚠️ ${message}`)
    }
    return
  }

  const typeMatch = /^\/type\s+(.+)$/is.exec(text)
  if (typeMatch) {
    // /type <query> runs the query through the normal pipeline on the desktop
    const query = typeMatch[1]!.trim()
    // Fall through to normal pipeline with the extracted query
    return handleGatewayMessage({ ...msg, text: query })
  }

  // ── Normal fast / agent pipeline ─────────────────────────────────────────
  const intent = await classifyIntent({ text })

  const chunks: string[] = []
  if (intent.path === "fast") {
    for await (const event of fastPipeline({ text, tts: false })) {
      if (event.type === "llm_chunk") chunks.push(event.text)
    }
    if (chunks.length) await sendReply(msg.platform, msg.chatId, chunks.join(""))
  } else {
    if (msg.yomiUserId) {
      await initConnectorRegistry(msg.yomiUserId).catch(() => {})
    }
    const driver = await getAgentDriver()
    const agentChunks: string[] = []
    for await (const event of driver({ text, plan: "max" })) {
      if (event.type === "agent_text") agentChunks.push(event.text)
    }
    if (agentChunks.length) await sendReply(msg.platform, msg.chatId, agentChunks.join(""))
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
