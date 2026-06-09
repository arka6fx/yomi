import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { PlatformAdapter } from "../platform-adapter.js"
import { truncateMessage } from "../platform-adapter.js"

const POLL_INTERVAL_MS = 3_000
const API_BASE = "https://graph.facebook.com/v25.0"

interface WhatsAppTextPayload {
  messaging_product: "whatsapp"
  recipient_type: "individual"
  to: string
  type: "text"
  text: { body: string; preview_url?: boolean }
}

interface WhatsAppApiResponse {
  messaging_product: "whatsapp"
  contacts: { input: string; wa_id: string }[]
  messages: { id: string }[]
  error?: { message: string; code: number }
}

interface WhatsAppWebhookPayload {
  object: string
  entry: {
    id: string
    changes: {
      value: {
        messaging_product: string
        metadata: { display_phone_number: string; phone_number_id: string }
        contacts?: { profile: { name: string }; wa_id: string }[]
        messages?: {
          from: string
          id: string
          timestamp: string
          type: string
          text?: { body: string }
          image?: { id: string; mime_type: string }
        }[]
        statuses?: { id: string; status: string; timestamp: string; recipient_id: string }[]
      }
      field: string
    }[]
  }[]
}

export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "whatsapp"
  private accessToken: string
  private phoneNumberId: string
  private verifyToken: string
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private messageHandler: ((msg: GatewayMessage) => void) | null = null
  private connected = false
  private webhookQueue: GatewayMessage[] = []
  private processedIds: Set<string> = new Set()

  constructor(accessToken: string, phoneNumberId: string, verifyToken: string) {
    this.accessToken = accessToken
    this.phoneNumberId = phoneNumberId
    this.verifyToken = verifyToken
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return
    const res = await fetch(
      `${API_BASE}/${this.phoneNumberId}`,
      { headers: this.headers },
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`WhatsApp API error ${res.status}: ${text}`)
    }
    console.warn("[gateway/whatsapp] connected")
    this.connected = true
    this.startPolling()
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.connected = false
    this.webhookQueue = []
    console.warn("[gateway/whatsapp] disconnected")
  }

  setMessageHandler(handler: (msg: GatewayMessage) => void): void {
    this.messageHandler = handler
  }

  getWebhookVerifyToken(): string {
    return this.verifyToken
  }

  handleWebhookPayload(body: WhatsAppWebhookPayload): void {
    console.warn("[gateway/whatsapp] webhook payload received:", JSON.stringify(body.entry?.length ?? 0).slice(0, 200))
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue
        const messages = change.value.messages ?? []
        console.warn(`[gateway/whatsapp] webhook: ${messages.length} message(s) in change`)
        for (const msg of messages) {
          if (this.processedIds.has(msg.id)) continue
          this.processedIds.add(msg.id)
          if (this.processedIds.size > 10_000) {
            const iter = this.processedIds.values().next()
            if (iter.value) this.processedIds.delete(iter.value)
          }

          const text = msg.type === "text" ? msg.text?.body ?? "" : `[${msg.type} message]`
          if (!text) continue

          const contacts = change.value.contacts ?? []
          const contactName =
            contacts.find((c) => c.wa_id === msg.from)?.profile.name ?? msg.from

          console.warn(`[gateway/whatsapp] enqueue msg from=${msg.from} text="${text.slice(0, 80)}" id=${msg.id}`)

          const gatewayMsg: GatewayMessage = {
            platform: "whatsapp",
            chatId: msg.from,
            userId: msg.from,
            text,
            messageId: msg.id,
            timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
          }
          this.webhookQueue.push(gatewayMsg)
        }
      }
    }
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const clean = truncateMessage(text, 4096)
      const body: WhatsAppTextPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: chatId,
        type: "text",
        text: { body: clean },
      }

      console.warn(`[gateway/whatsapp] send to=${chatId} phoneNumberId=${this.phoneNumberId} text="${clean.slice(0, 100)}"`)
      const res = await fetch(`${API_BASE}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as WhatsAppApiResponse
      console.warn(`[gateway/whatsapp] send response status=${res.status} msgId=${data.messages?.[0]?.id ?? "none"} error=${data.error?.message ?? "none"}`)
      if (data.error) {
        return { ok: false, error: `WhatsApp API ${data.error.code}: ${data.error.message}` }
      }
      return { ok: true, messageId: data.messages?.[0]?.id }
    } catch (err) {
      console.warn(`[gateway/whatsapp] send exception:`, err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: chatId,
          type: "action",
          action: { type: "mark_as_read" },
        } as Record<string, unknown>),
      })
    } catch {
      // best-effort
    }
  }

  async deleteMessage(
    chatId: string,
    messageId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "WhatsApp does not support message deletion via API" }
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => void this.drainQueue(), POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async drainQueue(): Promise<void> {
    if (!this.connected || !this.messageHandler) return
    if (this.webhookQueue.length === 0) return

    const batch = this.webhookQueue.splice(0)
    console.warn(`[gateway/whatsapp] draining ${batch.length} message(s) from queue`)
    for (const msg of batch) {
      this.messageHandler(msg)
    }
  }
}
