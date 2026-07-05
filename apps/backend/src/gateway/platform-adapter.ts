import type { PlatformType, GatewayMessage } from "@yomi/shared"

export interface PlatformAdapter {
  readonly platform: PlatformType
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>
  sendDocument(
    chatId: string,
    documentUrl: string,
    options?: { replyTo?: string; caption?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>
  sendTyping(chatId: string): Promise<void>
  deleteMessage(chatId: string, messageId: string): Promise<{ ok: boolean; error?: string }>
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void
}

export function removeMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[a-z]*\n([\s\S]*?)\n```/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/`([^`\n]+)`/g, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function truncateMessage(text: string, maxLen = 2000): string {
  if (text.length <= maxLen) return text
  if (maxLen <= 0) return ""
  const suffix = "\u2026"
  let end = maxLen - suffix.length
  if (end <= 0) return suffix
  const truncated = text.slice(0, end)
  const lastSpace = truncated.lastIndexOf(" ")
  if (lastSpace > Math.ceil(end * 0.5)) {
    return truncated.slice(0, lastSpace) + suffix
  }
  return truncated + suffix
}
