import { createHash, randomBytes } from "node:crypto"
import { eq, and } from "drizzle-orm"
import { db, platformConnections } from "@yomi/db"
import type { PlatformType, GatewayMessage, GatewaySessionInfo } from "@yomi/shared"
import type { PlatformAdapter } from "./platform-adapter.js"
import { TelegramAdapter } from "./platforms/telegram.js"
import { DiscordAdapter } from "./platforms/discord.js"
import { SlackAdapter } from "./platforms/slack.js"
import { WhatsAppAdapter } from "./platforms/whatsapp.js"

const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const LINK_CODE_TTL_MS = 10 * 60 * 1000

interface LinkingCode {
  platform: PlatformType
  platformUserId: string
  chatId: string
  expiresAt: number
}

export interface GatewayStatus {
  running: boolean
  adapters: { platform: PlatformType; connected: boolean; error?: string }[]
  activeSessions: number
}

interface GatewaySession {
  id: string
  platform: PlatformType
  chatId: string
  userId: string
  createdAt: number
  lastActivityAt: number
  messageCount: number
  pendingMessages: GatewayMessage[]
}

export type SidecarResolver = (
  userId: string,
  platform: PlatformType,
) => string | undefined | Promise<string | undefined>

export class GatewayRunner {
  private adapters: Map<PlatformType, PlatformAdapter> = new Map()
  private sessions: Map<string, GatewaySession> = new Map()
  private running = false
  private defaultSidecarUrl: string
  private sidecarSecret: string
  private sidecarResolver: SidecarResolver | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private linkingCodes: Map<string, LinkingCode> = new Map()

  constructor(sidecarUrl?: string, sidecarSecret?: string) {
    this.defaultSidecarUrl = sidecarUrl ?? process.env["SIDECAR_URL"] ?? "http://localhost:3002"
    this.sidecarSecret = sidecarSecret ?? process.env["SIDECAR_SECRET"] ?? ""
  }

  verifyLinkingCode(code: string): LinkingCode | null {
    const entry = this.linkingCodes.get(code.toUpperCase())
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.linkingCodes.delete(code.toUpperCase())
      return null
    }
    this.linkingCodes.delete(code.toUpperCase())
    return entry
  }

  private generateLinkingCode(msg: GatewayMessage): string {
    const code = randomBytes(3).toString("hex").toUpperCase().slice(0, 6)
    this.linkingCodes.set(code, {
      platform: msg.platform,
      platformUserId: msg.userId,
      chatId: msg.chatId,
      expiresAt: Date.now() + LINK_CODE_TTL_MS,
    })
    return code
  }

  private getLinkingPrompt(code: string): string {
    const appUrl = process.env["YOMI_APP_URL"]
      ?? process.env["NEXT_PUBLIC_APP_URL"]
      ?? process.env["BETTER_AUTH_URL"]
      ?? "https://yomi.ai"
    return (
      "Welcome to Yomi! Your account isn't linked yet.\n\n" +
      `Your code: *${code}*\n\n` +
      `Visit ${appUrl}/link and enter this code to connect your account. ` +
      `The code expires in 10 minutes.`
    )
  }

  private async isUserLinked(platform: PlatformType, platformUserId: string): Promise<boolean> {
    try {
      const row = await db
        .select({ id: platformConnections.id })
        .from(platformConnections)
        .where(
          and(
            eq(platformConnections.platform, platform),
            eq(platformConnections.platformUserId, platformUserId),
          ),
        )
        .limit(1)
        .then((r) => r[0])
      return !!row
    } catch {
      return false
    }
  }

  setSidecarResolver(resolver: SidecarResolver): void {
    this.sidecarResolver = resolver
  }

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter)
    adapter.setMessageHandler((msg) => void this.onIncoming(msg))
  }

  async start(_plan?: string): Promise<void> {
    if (this.running) return

    this.running = true
    console.warn("[gateway] starting")

    const telegramToken = process.env["TELEGRAM_BOT_TOKEN"]
    const discordToken = process.env["DISCORD_BOT_TOKEN"]
    const slackToken = process.env["SLACK_BOT_TOKEN"]
    const whatsappToken = process.env["WHATSAPP_ACCESS_TOKEN"]
    const whatsappPhoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"]
    const whatsappVerify = process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"] ?? "yomi"

    if (telegramToken) {
      const adapter = new TelegramAdapter(telegramToken)
      this.registerAdapter(adapter)
    }
    if (discordToken) {
      const adapter = new DiscordAdapter(discordToken)
      this.registerAdapter(adapter)
    }
    if (slackToken) {
      const adapter = new SlackAdapter(slackToken)
      this.registerAdapter(adapter)
    }
    if (whatsappToken && whatsappPhoneId) {
      const adapter = new WhatsAppAdapter(whatsappToken, whatsappPhoneId, whatsappVerify)
      this.registerAdapter(adapter)
    }

    const adapterList = Array.from(this.adapters.entries())
    const results = await Promise.allSettled(
      adapterList.map(([, a]) => a.connect()),
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === "rejected") {
        const platform = adapterList[i]?.[0] ?? "unknown"
        console.warn(`[gateway] ${platform} connect failed:`, r.reason)
      }
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupSessions()
      this.cleanupLinkingCodes()
    }, SESSION_CLEANUP_INTERVAL_MS)

    console.warn(`[gateway] running with ${this.adapters.size} adapter(s)`)
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    for (const adapter of this.adapters.values()) {
      try {
        void adapter.disconnect()
      } catch {
        // ignore
      }
    }
    this.adapters.clear()
    this.sessions.clear()

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    console.warn("[gateway] stopped")
  }

  isRunning(): boolean {
    return this.running
  }

  getAdapter(platform: PlatformType): PlatformAdapter | undefined {
    return this.adapters.get(platform)
  }

  async sendMessage(
    platform: PlatformType,
    chatId: string,
    text: string,
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return { ok: false, error: `platform "${platform}" not connected` }
    return adapter.sendMessage(chatId, text, options)
  }

  async sendTyping(platform: PlatformType, chatId: string): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    await adapter.sendTyping(chatId)
  }

  async broadcastMessage(text: string): Promise<void> {
    const adapterList = Array.from(this.adapters.entries())
    const results = await Promise.allSettled(
      adapterList.map(([platform, adapter]) => {
        console.warn(`[gateway] broadcasting to ${platform}`)
        return adapter.sendMessage("broadcast", text)
      }),
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === "rejected") {
        const platform = adapterList[i]?.[0] ?? "unknown"
        console.warn(`[gateway] broadcast to ${platform} failed:`, r.reason)
      }
    }
  }

  getStatus(): GatewayStatus {
    return {
      running: this.running,
      adapters: Array.from(this.adapters.entries()).map(([platform]) => ({
        platform,
        connected: this.running,
      })),
      activeSessions: this.sessions.size,
    }
  }

  getActiveSessions(): GatewaySessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      platform: s.platform,
      chatId: hashId(s.chatId),
      userId: hashId(s.userId),
      createdAt: new Date(s.createdAt).toISOString(),
      lastActivityAt: new Date(s.lastActivityAt).toISOString(),
      messageCount: s.messageCount,
    }))
  }

  async sendToSidecar(msg: GatewayMessage): Promise<void> {
    let url = this.defaultSidecarUrl
    if (msg.userId && msg.userId !== "unknown" && this.sidecarResolver) {
      const resolved = await this.sidecarResolver(msg.userId, msg.platform)
      if (resolved) url = resolved
    }

    const res = await fetch(`${url}/gateway/receive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.sidecarSecret}`,
      },
      body: JSON.stringify(msg),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown")
      console.warn(`[gateway] sidecar forward failed (${res.status}) to ${url}: ${text}`)
    }
  }

  private async onIncoming(msg: GatewayMessage): Promise<void> {
    // Prompt unlinked users to connect their account
    if (msg.userId && msg.userId !== "unknown") {
      const linked = await this.isUserLinked(msg.platform, msg.userId)
      if (!linked) {
        const code = this.generateLinkingCode(msg)
        const adapter = this.adapters.get(msg.platform)
        await adapter?.sendMessage(msg.chatId, this.getLinkingPrompt(code))
        return
      }
    }

    const session = this.getOrCreateSession(msg)

    const controlResult = this.handleControlCommand(msg, session)
    if (controlResult) {
      const adapter = this.adapters.get(msg.platform)
      await adapter?.sendMessage(msg.chatId, controlResult)
      return
    }

    if (session.pendingMessages.length > 0) {
      session.pendingMessages.push(msg)
      return
    }

    session.messageCount++
    session.lastActivityAt = Date.now()

    try {
      await this.sendToSidecar(msg)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn(`[gateway] forward error: ${errMsg}`)
      const adapter = this.adapters.get(msg.platform)
      await adapter?.sendMessage(msg.chatId, `Sorry, I encountered an error: ${errMsg}`)
    }
  }

  private getOrCreateSession(msg: GatewayMessage): GatewaySession {
    const sessionId = `${msg.platform}:${msg.chatId}`
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        id: sessionId,
        platform: msg.platform,
        chatId: msg.chatId,
        userId: msg.userId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        messageCount: 0,
        pendingMessages: [],
      }
      this.sessions.set(sessionId, session)
    }
    return session
  }

  private handleControlCommand(msg: GatewayMessage, _session: GatewaySession): string | null {
    const text = msg.text.trim()

    if (text === "/stop") {
      return "Current operation stopped. How can I help you next?"
    }

    if (text === "/new") {
      _session.messageCount = 0
      _session.createdAt = Date.now()
      _session.lastActivityAt = Date.now()
      return "Started a new conversation. How can I help you?"
    }

    if (text === "/approve" || text === "/yes") {
      return "Approval received. (Approval handling depends on the current operation.)"
    }

    if (text === "/deny" || text === "/no") {
      return "Action denied. How else can I help you?"
    }

    if (text === "/help") {
      return (
        "Available commands:\n" +
        "/stop — Stop the current operation\n" +
        "/new — Start a new conversation\n" +
        "/approve — Approve a pending action\n" +
        "/deny — Deny a pending action\n" +
        "/help — Show this message"
      )
    }

    return null
  }

  private cleanupLinkingCodes(): void {
    const now = Date.now()
    for (const [code, entry] of this.linkingCodes) {
      if (now > entry.expiresAt) this.linkingCodes.delete(code)
    }
  }

  private cleanupSessions(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > SESSION_TTL_MS) {
        this.sessions.delete(id)
      }
    }
  }
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 12)
}

let defaultGateway: GatewayRunner | null = null

export function getDefaultGateway(): GatewayRunner {
  if (!defaultGateway) defaultGateway = new GatewayRunner()
  return defaultGateway
}
