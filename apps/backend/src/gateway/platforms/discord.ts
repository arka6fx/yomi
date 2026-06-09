import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { PlatformAdapter } from "../platform-adapter.js"
import { removeMarkdown, truncateMessage } from "../platform-adapter.js"

const POLL_INTERVAL_MS = 5_000
const API_BASE = "https://discord.com/api/v10"

interface DiscordChannel {
  id: string
  type: number
  last_message_id?: string | null
}

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
    console.warn("[gateway/discord] connected")
    this.connected = true
    this.startPolling()
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.connected = false
    this.trackedChannels.clear()
    this.dmChannels.clear()
    this.knownChannels.clear()
    console.warn("[gateway/discord] disconnected")
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
        return { ok: false, error: `Discord ${res.status}: ${text}` }
      }
      const data = (await res.json()) as DiscordMessage
      // Track channels we've interacted with so they get polled
      // Also set the tracked position to this message so we don't replay old ones
      if (!this.knownChannels.has(chatId)) {
        this.knownChannels.add(chatId)
        if (!this.trackedChannels.has(chatId)) {
          this.trackedChannels.set(chatId, data.id)
        }
      }
      return { ok: true, messageId: data.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Register a DM channel so it gets polled for incoming messages
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

  private async discoverChannels(): Promise<DiscordChannel[]> {
    try {
      const guildsRes = await fetch(`${API_BASE}/users/@me/guilds`, { headers: this.headers })
      if (!guildsRes.ok) return []
      const guilds = (await guildsRes.json()) as { id: string }[]

      const channels: DiscordChannel[] = []
      for (const guild of guilds) {
        const chRes = await fetch(`${API_BASE}/guilds/${guild.id}/channels`, {
          headers: this.headers,
        })
        if (!chRes.ok) continue
        const guildChannels = (await chRes.json()) as DiscordChannel[]
        const textChannels = guildChannels.filter((c) => c.type === 0)
        channels.push(...textChannels)
      }
      return channels
    } catch {
      return []
    }
  }

  private async discoverDmChannels(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/users/@me/channels`, { headers: this.headers })
      if (!res.ok) {
        console.warn(`[discord] discoverDmChannels failed: ${res.status} ${res.statusText}`)
        return
      }
      const channels = (await res.json()) as { id: string; type: number; recipients?: { id: string }[] }[]
      console.warn(`[discord] discoverDmChannels: ${channels.length} total channels returned`)
      for (const channel of channels) {
        console.warn(`[discord]   channel id=${channel.id} type=${channel.type} recipients=${channel.recipients?.map(r => r.id).join(",")}`)
        // DM channels have type 1
        if (channel.type !== 1) {
          console.warn(`[discord]   skipping channel ${channel.id}: type=${channel.type} is not DM (type 1)`)
          continue
        }
        const recipient = channel.recipients?.[0]
        if (!recipient) {
          console.warn(`[discord]   skipping channel ${channel.id}: no recipients`)
          continue
        }
        if (recipient.id === this.botUserId) {
          console.warn(`[discord]   skipping channel ${channel.id}: recipient is bot self`)
          continue
        }
        console.warn(`[discord]   tracking DM channel: recipient=${recipient.id} channelId=${channel.id}`)
        this.dmChannels.set(recipient.id, channel.id)
      }
    } catch (err) {
      console.warn(`[discord] discoverDmChannels error:`, err)
    }
  }

  private async pollChannels(): Promise<void> {
    if (!this.connected || !this.messageHandler) return

    console.warn(`[discord] pollChannels start (connected=${this.connected}, handler=${!!this.messageHandler})`)

    // Refresh DM channel list
    await this.discoverDmChannels()

    const channels = await this.discoverChannels()
    // Also poll DM channels
    const dmEntries = Array.from(this.dmChannels.entries())
    console.warn(`[discord] pollChannels: ${channels.length} guild channels, ${dmEntries.length} DM entries, ${this.knownChannels.size} known channels`)
    const allChannels: { id: string; isDm: boolean }[] = [
      ...channels.map((c) => ({ id: c.id, isDm: false })),
      ...dmEntries.map(([, id]) => ({ id, isDm: true })),
      ...Array.from(this.knownChannels).filter((id) => !channels.some((c) => c.id === id) && !dmEntries.some(([, d]) => d === id)).map((id) => ({ id, isDm: true })),
    ]

    for (const channel of allChannels) {
      const lastKnown = this.trackedChannels.get(channel.id)
      try {
        const params = new URLSearchParams({ limit: "5" })
        const res = await fetch(
          `${API_BASE}/channels/${channel.id}/messages?${params}`,
          { headers: this.headers },
        )
        if (!res.ok) {
          console.warn(`[discord] poll channel ${channel.id} (dm=${channel.isDm}) failed: ${res.status}`)
          continue
        }
        const messages = (await res.json()) as DiscordMessage[]
        console.warn(`[discord]   channel ${channel.id} (dm=${channel.isDm}): ${messages.length} messages, lastKnown=${lastKnown ?? "none"}`)
        for (const msg of messages.reverse()) {
          const skipOld = lastKnown && msg.id <= lastKnown
          const skipBot = msg.author.bot || msg.author.id === this.botUserId
          console.warn(`[discord]   msg id=${msg.id} author=${msg.author.id} bot=${msg.author.bot} content="${msg.content.slice(0, 60)}" skipOld=${skipOld} skipBot=${skipBot}`)
          if (skipOld) continue
          if (skipBot) continue

          this.trackedChannels.set(channel.id, msg.id)
          const gatewayMsg: GatewayMessage = {
            platform: "discord",
            chatId: channel.id,
            userId: msg.author.id,
            text: msg.content,
            messageId: msg.id,
            timestamp: msg.timestamp,
          }
          console.warn(`[discord] DM received: sender=${msg.author.id} chat=${channel.id} content="${msg.content.slice(0, 80)}"`)
          this.messageHandler(gatewayMsg)
        }
      } catch (err) {
        console.warn(`[discord] poll channel ${channel.id} error:`, err)
      }
    }
  }
}
