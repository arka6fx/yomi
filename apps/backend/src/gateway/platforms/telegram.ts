import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { PlatformAdapter } from "../platform-adapter.js"
import { removeMarkdown, truncateMessage } from "../platform-adapter.js"

const API_BASE = "https://api.telegram.org/bot"

interface TelegramUpdate {
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
  private token: string
  private lastUpdateId = 0
  private messageHandler: ((msg: GatewayMessage) => void) | null = null
  private connected = false
  botUsername: string | null = null

  constructor(token: string) {
    this.token = token
  }

  private get apiUrl(): string {
    return `${API_BASE}${this.token}`
  }

  async connect(): Promise<void> {
    if (this.connected) return
    const res = await fetch(`${this.apiUrl}/getMe`)
    const data = (await res.json()) as TelegramResponse & { result?: { username?: string } }
    if (!data.ok) throw new Error(`Telegram API error: ${data.description ?? "unknown"}`)
    this.botUsername = data.result?.username ?? null
    console.warn(`[gateway/telegram] connected as @${this.botUsername}`)
    this.connected = true
    this.startPolling()
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.warn("[gateway/telegram] disconnected")
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

  private startPolling(): void {
    void this.pollLoop()
  }

  private async pollLoop(): Promise<void> {
    while (this.connected) {
      try {
        await this.poll()
      } catch {
        // brief pause on network error before retry
        await new Promise((r) => setTimeout(r, 2_000))
      }
    }
  }

  private async poll(): Promise<void> {
    if (!this.connected || !this.messageHandler) return
    try {
      const params = new URLSearchParams({
        timeout: "25",
        offset: String(this.lastUpdateId + 1),
      })
      const res = await fetch(`${this.apiUrl}/getUpdates?${params}`)
      const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] }
      if (!data.ok || !Array.isArray(data.result)) return

      for (const update of data.result) {
        if (update.update_id > this.lastUpdateId) {
          this.lastUpdateId = update.update_id
        }
        const msg = update.message
        if (!msg) continue
        if (msg.chat.type === "channel") continue

        const hasText = !!msg.text
        const voiceFile = msg.voice ?? msg.audio
        if (!hasText && !voiceFile) continue

        let audioUrl: string | undefined
        let audioMimeType: string | undefined

        if (voiceFile) {
          // Resolve file path via getFile API
          try {
            const fileRes = await fetch(`${this.apiUrl}/getFile?file_id=${voiceFile.file_id}`)
            const fileData = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } }
            if (fileData.ok && fileData.result?.file_path) {
              audioUrl = `https://api.telegram.org/file/bot${this.token}/${fileData.result.file_path}`
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
    } catch (err) {
      console.warn("[gateway/telegram] poll error:", err instanceof Error ? err.message : String(err))
    }
  }
}
