import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { PlatformAdapter } from "../platform-adapter.js"
import { removeMarkdown, truncateMessage } from "../platform-adapter.js"

const API_BASE = "https://discord.com/api/v10"
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"

interface DiscordPayload {
  op: number
  d?: unknown
  s?: number | null
  t?: string | null
}

export class DiscordAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "discord"
  private token: string
  private messageHandler: ((msg: GatewayMessage) => void) | null = null
  private connected = false
  private botUserId: string | null = null
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private seq: number | null = null
  private resumeUrl: string | null = null
  private sessionId: string | null = null
  private linkCodeHandler: ((code: string, userId: string, channelId: string) => void) | null = null
  private appId: string

  constructor(token: string, appId?: string) {
    this.token = token
    this.appId = appId ?? process.env["DISCORD_CLIENT_ID"] ?? ""
  }

  onLinkCode(handler: (code: string, userId: string, channelId: string) => void): void {
    this.linkCodeHandler = handler
  }

  private get restHeaders(): Record<string, string> {
    return {
      Authorization: `Bot ${this.token}`,
      "Content-Type": "application/json",
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return

    const me = await this.fetchBotUser()
    this.botUserId = me.id
    console.warn(`[discord] gateway connecting as bot ${me.id}`)

    await this.registerSlashCommands()
    this.connectGateway()
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.stopHeartbeat()
    if (this.ws) {
      try { this.ws.close(1000) } catch { /* ignore */ }
      this.ws = null
    }
    console.warn("[discord] disconnected")
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
      const clean = truncateMessage(removeMarkdown(text), 1900)
      const body: Record<string, unknown> = { content: clean }
      if (options?.replyTo) {
        body.message_reference = { message_id: options.replyTo }
      }

      const res = await fetch(`${API_BASE}/channels/${chatId}/messages`, {
        method: "POST",
        headers: this.restHeaders,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.text()
        return { ok: false, error: `Discord ${res.status}: ${err.slice(0, 200)}` }
      }
      const data = (await res.json()) as { id: string }
      return { ok: true, messageId: data.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/channels/${chatId}/typing`, {
        method: "POST",
        headers: this.restHeaders,
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
      const res = await fetch(`${API_BASE}/channels/${chatId}/messages/${messageId}`, {
        method: "DELETE",
        headers: this.restHeaders,
      })
      if (!res.ok && res.status !== 204) {
        const err = await res.text()
        return { ok: false, error: `Discord ${res.status}: ${err}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── Gateway WebSocket ───────────────────────────────────────────────────────

  private connectGateway(): void {
    this.ws = new WebSocket(this.resumeUrl ?? GATEWAY_URL)

    this.ws.onopen = () => {
      console.warn("[discord] gateway socket opened")
    }

    this.ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as DiscordPayload
        this.seq = payload.s ?? this.seq
        this.handleGatewayEvent(payload)
      } catch (err) {
        console.warn("[discord] gateway parse error:", err)
      }
    }

    this.ws.onclose = (event) => {
      console.warn(`[discord] gateway closed code=${event.code} reason=${event.reason}`)
      this.stopHeartbeat()
      if (this.connected) {
        // Reconnect after a short delay (Discord recommends 1-5s)
        setTimeout(() => {
          if (this.connected) this.connectGateway()
        }, 3_000)
      }
    }

    this.ws.onerror = (err) => {
      console.warn("[discord] gateway socket error:", err)
    }
  }

  private handleGatewayEvent(payload: DiscordPayload): void {
    switch (payload.op) {
      case 10: // HELLO
        this.onHello(payload.d as { heartbeat_interval: number })
        break
      case 0: // DISPATCH
        this.onDispatch(payload.t!, payload.d)
        break
      case 11: // HEARTBEAT_ACK
        break
      case 7: // RECONNECT
        this.onReconnect()
        break
      case 9: // INVALID_SESSION
        this.onInvalidSession(payload.d as boolean)
        break
      default:
        console.warn(`[discord] unhandled gateway op=${payload.op}`)
    }
  }

  private onHello(data: { heartbeat_interval: number }): void {
    this.startHeartbeat(data.heartbeat_interval)
    if (this.sessionId && this.seq !== null) {
      this.sendGateway({ op: 6, d: { token: this.token, session_id: this.sessionId, seq: this.seq } })
    } else {
      this.sendIdentify()
    }
  }

  private sendIdentify(): void {
    this.sendGateway({
      op: 2,
      d: {
        token: this.token,
        intents: 1 << 12 | 1 << 0, // DIRECT_MESSAGES | GUILDS
        properties: { os: "linux", browser: "yomi", device: "yomi" },
      },
    })
  }

  private onDispatch(eventType: string, data: unknown): void {
    switch (eventType) {
      case "READY":
        this.onReady(data as ReadyData)
        break
      case "INTERACTION_CREATE":
        this.onInteractionCreate(data as InteractionData)
        break
      case "MESSAGE_CREATE":
        this.onMessageCreate(data as MessageCreateData)
        break
      default:
        break
    }
  }

  private onReady(data: ReadyData): void {
    this.sessionId = data.session_id
    this.resumeUrl = data.resume_gateway_url
    this.connected = true
    console.warn(`[discord] gateway ready — session=${this.sessionId} guilds=${data.guilds?.length ?? 0}`)
  }

  private async onInteractionCreate(data: InteractionData): Promise<void> {
    if (data.type !== 2) return // not a slash command
    if (data.data.name !== "link") return

    const codeOpt = data.data.options?.find((o) => o.name === "code")
    const code = codeOpt?.value
    if (!code || typeof code !== "string" || code.length !== 6) {
      await this.respondInteraction(data, "Invalid code. Use `/link ABC123` with your 6-character code.")
      return
    }

    console.warn(`[discord] /link command: code=${code} user=${data.member?.user?.id ?? data.user?.id ?? "unknown"}`)
    const userId = data.member?.user?.id ?? data.user?.id
    const channelId = data.channel_id
    if (!userId || !channelId) return

    if (this.linkCodeHandler) {
      this.linkCodeHandler(code.toUpperCase(), userId, channelId)
    }
  }

  private onMessageCreate(data: MessageCreateData): void {
    if (!this.messageHandler) return
    if (data.author.bot || data.author.id === this.botUserId) return
    // Only process DMs (guild_id is undefined for DM channels)
    if (!data.guild_id && !data.member) {
      console.warn(`[discord] DM received: sender=${data.author.id} channel=${data.channel_id} text="${data.content.slice(0, 80)}"`)
      const gatewayMsg: GatewayMessage = {
        platform: "discord",
        chatId: data.channel_id,
        userId: data.author.id,
        text: data.content,
        messageId: data.id,
        timestamp: data.timestamp ?? new Date().toISOString(),
      }
      this.messageHandler(gatewayMsg)
    }
  }

  private onReconnect(): void {
    if (this.ws) {
      try { this.ws.close(4000) } catch { /* ignore */ }
      this.ws = null
    }
    this.connectGateway()
  }

  private onInvalidSession(resumable: boolean): void {
    if (resumable) {
      this.sendIdentify()
    } else {
      this.sessionId = null
      this.seq = null
      setTimeout(() => {
        if (this.connected) this.sendIdentify()
      }, 2_000)
    }
  }

  // ── Gateway helpers ─────────────────────────────────────────────────────────

  private sendGateway(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.sendGateway({ op: 1, d: this.seq })
    }, intervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private async respondInteraction(data: InteractionData, content: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/interactions/${data.id}/${data.token}/callback`, {
        method: "POST",
        headers: this.restHeaders,
        body: JSON.stringify({ type: 4, data: { content, flags: 64 } }),
      })
    } catch (err) {
      console.warn("[discord] interaction response error:", err)
    }
  }

  // ── REST helpers ────────────────────────────────────────────────────────────

  private async fetchBotUser(): Promise<{ id: string }> {
    const res = await fetch(`${API_BASE}/users/@me`, { headers: this.restHeaders })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Discord API error ${res.status}: ${text}`)
    }
    return (await res.json()) as { id: string }
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.appId) {
      console.warn("[discord] cannot register slash commands — no appId")
      return
    }

    try {
      // Check if /link already exists
      const listRes = await fetch(`${API_BASE}/applications/${this.appId}/commands`, {
        headers: this.restHeaders,
      })
      if (listRes.ok) {
        const existing = (await listRes.json()) as { name: string }[]
        if (existing.some((c) => c.name === "link")) {
          console.warn("[discord] /link command already registered")
          return
        }
      }

      const body = {
        name: "link",
        description: "Link your Discord account to Yomi",
        options: [
          {
            name: "code",
            description: "Your 6-character linking code from the Yomi website",
            type: 3, // STRING
            required: true,
            min_length: 6,
            max_length: 6,
          },
        ],
      }

      const res = await fetch(`${API_BASE}/applications/${this.appId}/commands`, {
        method: "POST",
        headers: this.restHeaders,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        console.warn(`[discord] slash command registration failed (${res.status}): ${text}`)
      } else {
        const cmd = (await res.json()) as { id: string; name: string }
        console.warn(`[discord] registered /${cmd.name} command (id=${cmd.id})`)
      }
    } catch (err) {
      console.warn("[discord] slash command registration error:", err)
    }
  }

  async respondToInteraction(
    interactionId: string,
    interactionToken: string,
    content: string,
  ): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/interactions/${interactionId}/${interactionToken}/callback`, {
        method: "POST",
        headers: this.restHeaders,
        body: JSON.stringify({
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: { content, flags: 64 }, // EPHEMERAL
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        console.warn(`[discord] interaction response failed (${res.status}): ${text}`)
      }
    } catch (err) {
      console.warn("[discord] interaction response error:", err)
    }
  }
}

// ── Gateway data types ────────────────────────────────────────────────────────

interface ReadyData {
  v: number
  user: { id: string; username: string }
  session_id: string
  resume_gateway_url: string
  guilds?: { id: string }[]
}

interface InteractionData {
  id: string
  token: string
  type: number
  channel_id: string
  data: {
    name: string
    options?: { name: string; value: string; type: number }[]
  }
  member?: { user: { id: string; username: string } }
  user?: { id: string; username: string }
  guild_id?: string
}

interface MessageCreateData {
  id: string
  channel_id: string
  author: { id: string; username: string; bot?: boolean }
  content: string
  timestamp: string | null
  guild_id?: string
  member?: unknown
}
