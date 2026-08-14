import type { GatewayMessage, PlatformType } from "@yomi/shared"
import { humanizeDashes } from "@yomi/shared"
import type { PlatformAdapter, InlineButton, PlatformCallbackEvent } from "../platform-adapter.js"
import { markdownToTelegramHtml, truncateMessage } from "../platform-adapter.js"

const API_BASE = "https://api.telegram.org/bot"
const REQUIRED_WEBHOOK_UPDATES = ["message", "callback_query"] as const

function toInlineKeyboard(buttons: InlineButton[][]) {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    ),
  }
}

interface TelegramMessage {
  message_id: number
  from?: { id: number; first_name?: string; username?: string }
  chat: { id: number; type: string }
  text?: string
  caption?: string
  voice?: { file_id: string; duration: number; mime_type?: string }
  audio?: { file_id: string; mime_type?: string }
  photo?: Array<{ file_id: string; width: number; height: number; file_size?: number }>
  document?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number }
  video?: {
    file_id: string
    mime_type?: string
    duration: number
    file_size?: number
    file_name?: string
  }
  location?: { latitude: number; longitude: number }
  sticker?: { file_id: string; emoji?: string; set_name?: string }
  reply_to_message?: TelegramMessage
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: {
    id: string
    from: { id: number }
    message?: { message_id: number; chat: { id: number; type: string } }
    data?: string
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
  private messageHandler: ((msg: GatewayMessage) => void | Promise<void>) | null = null
  private callbackHandler: ((event: PlatformCallbackEvent) => void | Promise<void>) | null = null
  private connected = false
  botUsername: string | null = null

  constructor(token: string) {
    this.botToken = token
  }

  private get apiUrl(): string {
    return `${API_BASE}${this.botToken}`
  }

  private get webhookUrl(): string {
    const base = process.env["BETTER_AUTH_BASE_URL"] ?? "https://api.getyomi.in"
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

    // Clears any command list registered previously (via BotFather or an
    // earlier deploy) so the "/" autocomplete popup never reappears —
    // Telegram has no per-source command lists, the last write wins, so this
    // is self-healing on every boot rather than a one-time manual edit.
    try {
      await fetch(`${this.apiUrl}/deleteMyCommands`, { method: "POST" })
    } catch (err) {
      console.warn("[gateway/telegram] deleteMyCommands failed:", err)
    }

    const webAppBaseUrl = process.env["CORS_ORIGIN"] ?? "https://getyomi.in"
    try {
      await fetch(`${this.apiUrl}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu_button: {
            type: "web_app",
            text: "Dashboard",
            web_app: { url: `${webAppBaseUrl}/telegram-app` },
          },
        }),
      })
    } catch (err) {
      console.warn("[gateway/telegram] setChatMenuButton failed:", err)
    }

    // Register webhook — Telegram will POST updates here instead of relying
    // on long-polling (which doesn't work reliably on Cloudflare Workers).
    // connect() runs on every isolate boot (stateless Workers), so only
    // re-register when the webhook actually points elsewhere: re-registering
    // constantly churned Telegram delivery, and drop_pending_updates deleted
    // users' queued messages every time an isolate started.
    const infoRes = await fetch(`${this.apiUrl}/getWebhookInfo`)
    const info = (await infoRes.json()) as TelegramResponse & {
      result?: { url?: string; last_error_message?: string; allowed_updates?: string[] }
    }
    // Re-register when the URL is wrong OR when Telegram reports a delivery
    // error. getWebhookInfo never returns the stored secret_token, so a webhook
    // registered without our secret (e.g. a manual cutover curl) would 403 every
    // update forever, since the URL matches so the equality check alone never heals it.
    // Re-registering refreshes secret_token; gating on an error keeps steady-state
    // boots from churning delivery. We never drop_pending_updates so queued
    // messages survive.
    const hasDeliveryError = !!info.result?.last_error_message
    const webhookUpdates = info.result?.allowed_updates
    const isMissingRequiredUpdate =
      Array.isArray(webhookUpdates) &&
      REQUIRED_WEBHOOK_UPDATES.some((update) => !webhookUpdates.includes(update))
    if (info.result?.url !== this.webhookUrl || hasDeliveryError || isMissingRequiredUpdate) {
      const whRes = await fetch(`${this.apiUrl}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: this.webhookUrl,
          allowed_updates: [...REQUIRED_WEBHOOK_UPDATES],
          secret_token: this.botToken.replace(/[^A-Za-z0-9_-]/g, ""),
        }),
      })
      const whData = (await whRes.json()) as TelegramResponse
      if (!whData.ok) {
        throw new Error(`Telegram setWebhook error: ${whData.description ?? "unknown"}`)
      }
      console.warn(
        `[gateway/telegram] webhook set to ${this.webhookUrl}${hasDeliveryError ? ` (recovering from: ${info.result?.last_error_message})` : ""}`,
      )
    }

    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
    // Deliberately leave the webhook registered: this adapter is per-isolate
    // on stateless Workers, and deleting the webhook here would stop ALL
    // message delivery until some future isolate re-registers it.
    console.warn("[gateway/telegram] disconnected")
  }

  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void {
    this.messageHandler = handler
  }

  setCallbackHandler(handler: (event: PlatformCallbackEvent) => void | Promise<void>): void {
    this.callbackHandler = handler
  }

  /** Convert a Telegram API update to a GatewayMessage and dispatch to the handler. */
  async processUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      const cq = update.callback_query
      if (this.callbackHandler && cq.message) {
        await this.callbackHandler({
          chatId: String(cq.message.chat.id),
          platformUserId: String(cq.from.id),
          messageId: String(cq.message.message_id),
          data: cq.data ?? "",
          callbackId: cq.id,
        })
      }
      return
    }

    if (!this.messageHandler) return

    const msg = update.message
    if (!msg) return
    if (msg.chat.type === "channel") return

    const text = msg.text ?? msg.caption ?? ""
    const hasText = !!text
    const voiceFile = msg.voice ?? msg.audio
    const imageSource =
      msg.photo?.length || msg.document?.mime_type?.startsWith("image/")
        ? msg
        : msg.reply_to_message
    const imageFile = imageSource?.photo?.length
      ? [...imageSource.photo].sort(
          (a, b) => (b.file_size ?? b.width * b.height) - (a.file_size ?? a.width * a.height),
        )[0]
      : imageSource?.document?.mime_type?.startsWith("image/")
        ? imageSource.document
        : undefined
    const documentFile =
      msg.document && !msg.document.mime_type?.startsWith("image/") ? msg.document : undefined
    if (
      !hasText &&
      !voiceFile &&
      !imageFile &&
      !documentFile &&
      !msg.video &&
      !msg.location &&
      !msg.sticker
    )
      return

    let audioUrl: string | undefined
    let audioMimeType: string | undefined
    if (voiceFile) {
      try {
        const fileRes = await fetch(`${this.apiUrl}/getFile?file_id=${voiceFile.file_id}`)
        const fileData = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } }
        if (fileData.ok && fileData.result?.file_path) {
          audioUrl = `https://api.telegram.org/file/bot${this.botToken}/${fileData.result.file_path}`
          audioMimeType = voiceFile.mime_type ?? "audio/ogg"
        }
      } catch {
        /* best-effort */
      }
    }

    let imageUrl: string | undefined
    let imageMimeType: string | undefined
    if (imageFile) {
      try {
        const fileRes = await fetch(`${this.apiUrl}/getFile?file_id=${imageFile.file_id}`)
        const fileData = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } }
        if (fileData.ok && fileData.result?.file_path) {
          imageUrl = `https://api.telegram.org/file/bot${this.botToken}/${fileData.result.file_path}`
          imageMimeType = "mime_type" in imageFile ? imageFile.mime_type : "image/jpeg"
        }
      } catch {
        /* best-effort */
      }
    }

    let documentUrl: string | undefined
    let documentMimeType: string | undefined
    let documentFileName: string | undefined
    let documentSize: number | undefined
    if (documentFile) {
      try {
        const fileRes = await fetch(`${this.apiUrl}/getFile?file_id=${documentFile.file_id}`)
        const fileData = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } }
        if (fileData.ok && fileData.result?.file_path) {
          documentUrl = `https://api.telegram.org/file/bot${this.botToken}/${fileData.result.file_path}`
          documentMimeType = documentFile.mime_type
          documentFileName = "file_name" in documentFile ? documentFile.file_name : undefined
          documentSize = "file_size" in documentFile ? documentFile.file_size : undefined
        }
      } catch {
        /* best-effort */
      }
    }

    let videoUrl: string | undefined
    let videoMimeType: string | undefined
    let videoDurationSeconds: number | undefined
    const video = msg.video ?? msg.reply_to_message?.video
    if (video) {
      try {
        const fileRes = await fetch(`${this.apiUrl}/getFile?file_id=${video.file_id}`)
        const fileData = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } }
        if (fileData.ok && fileData.result?.file_path) {
          videoUrl = `https://api.telegram.org/file/bot${this.botToken}/${fileData.result.file_path}`
          videoMimeType = video.mime_type
          videoDurationSeconds = video.duration
        }
      } catch {
        /* best-effort */
      }
    }

    const audioDurationSeconds =
      voiceFile && "duration" in voiceFile && typeof voiceFile.duration === "number"
        ? voiceFile.duration
        : undefined

    const gatewayMsg: GatewayMessage = {
      platform: "telegram",
      chatId: String(msg.chat.id),
      userId: String(msg.from?.id ?? "unknown"),
      text,
      messageId: String(msg.message_id),
      timestamp: new Date().toISOString(),
      audioUrl,
      audioMimeType,
      audioDurationSeconds,
      imageUrl,
      imageMimeType,
      documentUrl,
      documentMimeType,
      documentFileName,
      documentSize,
      videoUrl,
      videoMimeType,
      videoDurationSeconds,
      location: msg.location,
      sticker: msg.sticker
        ? { emoji: msg.sticker.emoji, setName: msg.sticker.set_name }
        : undefined,
    }
    await this.messageHandler(gatewayMsg)
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string; buttons?: InlineButton[][] },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      // Truncate the plain markdown before converting to HTML tags, never after —
      // cutting a formatted string mid-tag (e.g. "<b>bo") would leave Telegram's
      // strict HTML parser an unterminated tag and reject the whole message.
      const clean = markdownToTelegramHtml(truncateMessage(humanizeDashes(text)))
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: clean,
        parse_mode: "HTML",
      }
      if (options?.replyTo) body.reply_to_message_id = Number(options.replyTo)
      if (options?.buttons) body.reply_markup = toInlineKeyboard(options.buttons)

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

  async sendDocument(
    chatId: string,
    documentUrl: string,
    options?: { replyTo?: string; caption?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        document: documentUrl,
      }
      if (options?.caption) {
        body.caption = markdownToTelegramHtml(truncateMessage(options.caption, 900))
        body.parse_mode = "HTML"
      }
      if (options?.replyTo) body.reply_to_message_id = Number(options.replyTo)

      const res = await fetch(`${this.apiUrl}/sendDocument`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "send document failed" }
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

  async deleteMessage(chatId: string, messageId: string): Promise<{ ok: boolean; error?: string }> {
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

  async editMessageText(
    chatId: string,
    messageId: string,
    text: string,
    options?: { buttons?: InlineButton[][] },
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const clean = markdownToTelegramHtml(truncateMessage(humanizeDashes(text)))
      const res = await fetch(`${this.apiUrl}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId),
          text: clean,
          parse_mode: "HTML",
          reply_markup: toInlineKeyboard(options?.buttons ?? []),
        }),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "edit failed" }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async editMessageReplyMarkup(
    chatId: string,
    messageId: string,
    buttons?: InlineButton[][],
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.apiUrl}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId),
          reply_markup: toInlineKeyboard(buttons ?? []),
        }),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "edit markup failed" }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async answerCallbackQuery(callbackId: string, text?: string): Promise<void> {
    try {
      await fetch(`${this.apiUrl}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackId, text }),
      })
    } catch {
      // best-effort — a failed ack just leaves the client's tap spinner
      // running a little longer, it doesn't block anything downstream
    }
  }

  async setReaction(
    chatId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.apiUrl}/setMessageReaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId),
          reaction: [{ type: "emoji", emoji }],
        }),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "reaction failed" }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
