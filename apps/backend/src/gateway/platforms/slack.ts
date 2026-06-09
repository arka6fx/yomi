import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { PlatformAdapter } from "../platform-adapter.js"
import { removeMarkdown, truncateMessage } from "../platform-adapter.js"

const POLL_INTERVAL_MS = 5_000
const API_BASE = "https://slack.com/api"

interface SlackResponse {
  ok: boolean
  error?: string
  channels?: SlackConversation[]
  messages?: SlackMessage[]
}

interface SlackConversation {
  id: string
  is_channel: boolean
  is_im: boolean
  is_mpim: boolean
  name?: string
}

interface SlackMessage {
  type: string
  ts: string
  user: string
  text: string
  channel?: string
  bot_id?: string
  subtype?: string
}

export class SlackAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "slack"
  private token: string
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private messageHandler: ((msg: GatewayMessage) => void) | null = null
  private connected = false
  private trackedConversations: Map<string, string> = new Map()

  constructor(token: string) {
    this.token = token
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return
    const res = await fetch(`${API_BASE}/auth.test`, { headers: this.headers })
    const data = (await res.json()) as SlackResponse
    if (!data.ok) throw new Error(`Slack API error: ${data.error ?? "unknown"}`)
    console.warn("[gateway/slack] connected")
    this.connected = true
    this.startPolling()
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.connected = false
    this.trackedConversations.clear()
    console.warn("[gateway/slack] disconnected")
  }

  setMessageHandler(handler: (msg: GatewayMessage) => void): void {
    this.messageHandler = handler
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const clean = truncateMessage(removeMarkdown(text), 39000)
      const body: Record<string, unknown> = {
        channel: chatId,
        text: clean,
      }
      if (options?.replyTo) {
        body.thread_ts = options.replyTo
      }

      const res = await fetch(`${API_BASE}/chat.postMessage`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as SlackResponse
      if (!data.ok) return { ok: false, error: data.error ?? "send failed" }
      return { ok: true, messageId: data.messages?.[0]?.ts }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async sendTyping(_chatId: string): Promise<void> {
    // Slack does not have a typing indicator API for bots
  }

  async deleteMessage(
    chatId: string,
    messageId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/chat.delete`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ channel: chatId, ts: messageId }),
      })
      const data = (await res.json()) as SlackResponse
      if (!data.ok) return { ok: false, error: data.error ?? "delete failed" }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => void this.pollConversations(), POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async discoverConversations(): Promise<SlackConversation[]> {
    try {
      const res = await fetch(
        `${API_BASE}/conversations.list?types=im,public_channel&limit=100`,
        { headers: this.headers },
      )
      const data = (await res.json()) as SlackResponse
      if (!data.ok) return []
      return data.channels ?? []
    } catch {
      return []
    }
  }

  private async pollConversations(): Promise<void> {
    if (!this.connected || !this.messageHandler) return

    const conversations = await this.discoverConversations()
    for (const conv of conversations) {
      const latestKnown = this.trackedConversations.get(conv.id)
      try {
        const params = new URLSearchParams({
          channel: conv.id,
          limit: "5",
          inclusive: "false",
        })
        if (latestKnown) params.set("oldest", latestKnown)

        const res = await fetch(`${API_BASE}/conversations.history?${params}`, {
          headers: this.headers,
        })
        const data = (await res.json()) as SlackResponse
        if (!data.ok) continue

        const messages = data.messages ?? []
        for (const msg of messages.reverse()) {
          if (msg.bot_id || msg.subtype === "bot_message") continue
          if (msg.type !== "message") continue

          this.trackedConversations.set(conv.id, msg.ts)
          const gatewayMsg: GatewayMessage = {
            platform: "slack",
            chatId: conv.id,
            userId: msg.user ?? "unknown",
            text: msg.text,
            messageId: msg.ts,
            timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          }
          this.messageHandler(gatewayMsg)
        }
      } catch {
        // skip inaccessible conversations
      }
    }
  }
}
