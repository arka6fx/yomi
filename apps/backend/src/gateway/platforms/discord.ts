import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { PlatformAdapter } from "../platform-adapter.js"
import { removeMarkdown, truncateMessage } from "../platform-adapter.js"

const POLL_INTERVAL_MS = 5_000
const API_BASE = "https://discord.com/api/v10"

interface DiscordMessage {
  id: string
  channel_id: string
  author: { id: string; global_name?: string; username: string; bot?: boolean }
  content: string
  timestamp: string
}

export class DiscordAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "discord"
  private token: string
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private messageHandler: ((msg: GatewayMessage) => void) | null = null
  private connected = false
  private botUserId: string | null = null
  private trackedChannels: Map<string, string> = new Map()
  private dmChannels: Map<string, string> = new Map()
  private knownChannels: Set<string> = new Set()

  constructor(token: string) {
    this.token = token
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bot ${this.token}`,
      "Content-Type": "application/json",
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return
    const res = await fetch(`${API_BASE}/users/@me`, { headers: this.headers })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Discord API error ${res.status}: ${text}`)
    }
    const me = (await res.json()) as { id: string; bot?: boolean }
    this.botUserId = me.id
    console.warn(`[discord] connected as bot user ${me.id}`)
    this.connected = true
    this.startPolling()
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.connected = false
    this.trackedChannels.clear()
    this.dmChannels.clear()
    this.knownChannels.clear()
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
        headers: this.headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        console.warn(`[discord] sendMessage to ${chatId} failed: ${res.status} ${text.slice(0, 200)}`)
        return { ok: false, error: `Discord ${res.status}: ${text}` }
      }
      const data = (await res.json()) as DiscordMessage
      // Track channels we've interacted with so they get polled.
      // Set the tracked position to this message so we don't replay old ones.
      if (!this.knownChannels.has(chatId)) {
        this.knownChannels.add(chatId)
        if (!this.trackedChannels.has(chatId)) {
          this.trackedChannels.set(chatId, data.id)
        }
        console.warn(`[discord] auto-registered channel ${chatId} from sendMessage`)
      }
      return { ok: true, messageId: data.id }
    } catch (err) {
      console.warn(`[discord] sendMessage error:`, err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Register a DM channel so it gets polled for incoming messages.
  // Called after OAuth DM creation and from gateway bootstrap.
  registerDmChannel(channelId: string): void {
    if (!this.knownChannels.has(channelId)) {
      this.knownChannels.add(channelId)
      console.warn(`[discord] registered DM channel ${channelId} for polling`)
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/channels/${chatId}/typing`, {
        method: "POST",
        headers: this.headers,
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
        headers: this.headers,
      })
      if (!res.ok && res.status !== 204) {
        const text = await res.text()
        return { ok: false, error: `Discord ${res.status}: ${text}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => void this.pollChannels(), POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // Attempt to discover DM channels via Discord API.
  // Known limitation: GET /users/@me/channels often returns [] for bots.
  // Primary DM tracking is through registerDmChannel() + bootstrap + sendMessage auto-registration.
  private async discoverDmChannels(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/users/@me/channels`, { headers: this.headers })
      if (!res.ok) {
        console.warn(`[discord] GET /users/@me/channels failed: ${res.status} ${res.statusText}`)
        return
      }
      const channels = (await res.json()) as { id: string; type: number; recipients?: { id: string }[] }[]
      console.warn(`[discord] discoverDmChannels: API returned ${channels.length} total channels`)
      for (const channel of channels) {
        console.warn(`[discord]   channel id=${channel.id} type=${channel.type} recipients=${channel.recipients?.map(r => r.id).join(",")}`)
        if (channel.type !== 1) {
          console.warn(`[discord]   skipping channel ${channel.id}: type=${channel.type} (not DM type 1)`)
          continue
        }
        const recipient = channel.recipients?.[0]
        if (!recipient) {
          console.warn(`[discord]   skipping channel ${channel.id}: no recipient`)
          continue
        }
        if (recipient.id === this.botUserId) {
          console.warn(`[discord]   skipping channel ${channel.id}: recipient is bot self`)
          continue
        }
        console.warn(`[discord]   discovered DM: recipient=${recipient.id} channelId=${channel.id}`)
        this.dmChannels.set(recipient.id, channel.id)
        // Also add to knownChannels so it gets polled
        this.knownChannels.add(channel.id)
      }
    } catch (err) {
      console.warn("[discord] discoverDmChannels error:", err)
    }
  }

  private async pollChannels(): Promise<void> {
    if (!this.connected || !this.messageHandler) return

    // Refresh DM channel list from API (best-effort, returns [] for bots)
    await this.discoverDmChannels()

    // Build poll list: DM channels + known channels (no guild dependency)
    const dmEntries = Array.from(this.dmChannels.entries())
    const allChannels: { id: string; isDm: boolean }[] = [
      ...dmEntries.map(([, id]) => ({ id, isDm: true })),
      ...Array.from(this.knownChannels).filter((id) => !dmEntries.some(([, d]) => d === id)).map((id) => ({ id, isDm: true })),
    ]

    console.warn(`[discord] poll: ${dmEntries.length} DM entries, ${this.knownChannels.size} total known, ${allChannels.length} to poll`)

    for (const channel of allChannels) {
      const lastKnown = this.trackedChannels.get(channel.id)
      try {
        const params = new URLSearchParams({ limit: "5" })
        const res = await fetch(
          `${API_BASE}/channels/${channel.id}/messages?${params}`,
          { headers: this.headers },
        )
        if (!res.ok) {
          if (res.status === 403 || res.status === 404) {
            // Channel no longer accessible — remove from tracking
            console.warn(`[discord] channel ${channel.id} returned ${res.status}, removing from tracking`)
            this.knownChannels.delete(channel.id)
            this.trackedChannels.delete(channel.id)
          } else {
            console.warn(`[discord] poll channel ${channel.id} failed: ${res.status}`)
          }
          continue
        }
        const messages = (await res.json()) as DiscordMessage[]
        for (const msg of messages.reverse()) {
          const skipOld = lastKnown && msg.id <= lastKnown
          const skipBot = msg.author.bot || msg.author.id === this.botUserId
          if (skipOld || skipBot) continue

          this.trackedChannels.set(channel.id, msg.id)
          const gatewayMsg: GatewayMessage = {
            platform: "discord",
            chatId: channel.id,
            userId: msg.author.id,
            text: msg.content,
            messageId: msg.id,
            timestamp: msg.timestamp,
          }
          console.warn(`[discord] incoming DM: sender=${msg.author.id} chat=${channel.id} text="${msg.content.slice(0, 80)}"`)
          this.messageHandler(gatewayMsg)
        }
      } catch (err) {
        console.warn(`[discord] poll channel ${channel.id} error:`, err)
      }
    }
  }
}
