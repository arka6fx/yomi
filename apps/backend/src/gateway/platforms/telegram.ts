import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { PlatformAdapter } from "../platform-adapter.js"
import { removeMarkdown, truncateMessage } from "../platform-adapter.js"

const API_BASE = "https://api.telegram.org/bot"

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; first_name?: string; username?: string }
    chat: { id: number; type: string }
    text?: string
    voice?: { file_id: string; duration: number; mime_type?: string }
    audio?: { file_id: string; mime_type?: string }
  }
}

interface TelegramResponse {
  ok: boolean
  description?: string
  result?: Record<string, unknown>
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "telegram"
  readonly botToken: string
  private messageHandler: ((msg: GatewayMessage) => void) | null = null
  private connected = false
  botUsername: string | null = null

  constructor(token: string) {
    this.botToken = token
  }

  private get apiUrl(): string {
    return `${API_BASE}${this.botToken}`
  }

  private get webhookUrl(): string {
    const base = process.env["BETTER_AUTH_BASE_URL"] ?? "https://api.yomi.arka6fx.com"
    return `${base}/api/gateway/telegram/webhook/${this.botToken}`
  }

  async connect(): Promise<void> {
    if (this.connected) return

    // Verify token and get bot info
    const res = await fetch(`${this.apiUrl}/getMe`)
    const data = (await res.json()) as TelegramResponse & { result?: { username?: string } }
    if (!data.ok) throw new Error(`Telegram API error: ${data.description ?? "unknown"}`)
    this.botUsername = data.result?.username ?? null
    console.warn(`[gateway/telegram] connected as @${this.botUsername}`)

    // Register webhook — Telegram will POST updates here instead of relying
    // on long-polling (which doesn't work reliably on Cloudflare Workers).
    const whRes = await fetch(`${this.apiUrl}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: this.webhookUrl,
        allowed_updates: ["message"],
        drop_pending_updates: true,
        secret_token: this.botToken.replace(/[^A-Za-z0-9_-]/g, ""),
      }),
    })
    const whData = (await whRes.json()) as TelegramResponse
    if (!whData.ok) {
      throw new Error(`Telegram setWebhook error: ${whData.description ?? "unknown"}`)
    }
    console.warn(`[gateway/telegram] webhook set to ${this.webhookUrl}`)

    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
    // Remove webhook so stale updates don't accumulate
    try {
      await fetch(`${this.apiUrl}/deleteWebhook`, { method: "POST" })
    } catch { /* best-effort */ }
    console.warn("[gateway/telegram] disconnected")
  }

  setMessageHandler(handler: (msg: GatewayMessage) => void): void {
    this.messageHandler = handler
  }

  /** Convert a Telegram API update to a GatewayMessage and dispatch to the handler. */
  async processUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.messageHandler) return

    const msg = update.message
    if (!msg) return
    if (msg.chat.type === "channel") return

    const hasText = !!msg.text
    const voiceFile = msg.voice ?? msg.audio
    if (!hasText && !voiceFile) return

    let audioUrl: string | undefined
    let audioMimeType: string | undefined
    if (voiceFile) {
      // Resolve file path via getFile API
      try {
        const fileRes = await fetch(`${this.apiUrl}/getFile?file_id=${voiceFile.file_id}`)
        const fileData = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } }
        if (fileData.ok && fileData.result?.file_path) {
          audioUrl = `https://api.telegram.org/file/bot${this.botToken}/${fileData.result.file_path}`
          audioMimeType = voiceFile.mime_type ?? "audio/ogg"
        }
      } catch { /* best-effort — message will have empty text */ }
    }

    const gatewayMsg: GatewayMessage = {
      platform: "telegram",
      chatId: String(msg.chat.id),
      userId: String(msg.from?.id ?? "unknown"),
      text: msg.text ?? "",
      messageId: String(msg.message_id),
      timestamp: new Date().toISOString(),
      audioUrl,
      audioMimeType,
    }
    this.messageHandler(gatewayMsg)
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const clean = truncateMessage(removeMarkdown(text))
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: clean,
        parse_mode: undefined,
      }
      if (options?.replyTo) body.reply_to_message_id = Number(options.replyTo)

      const res = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "send failed" }
      return { ok: true, messageId: String(data.result?.message_id ?? "") }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await fetch(`${this.apiUrl}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      })
    } catch {
      // best-effort
    }
  }

  async deleteMessage(
    chatId: string,
    messageId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.apiUrl}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId),
        }),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "delete failed" }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
