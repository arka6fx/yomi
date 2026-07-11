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
  // URLs are held out of the way first: Drive file IDs contain underscores, and an
  // emphasis rule that ate them turned a working link into a dead "unable to open
  // the file" page. Nothing inside a URL is markdown.
  const urls: string[] = []
  const withoutUrls = text.replace(/https?:\/\/\S+/g, (url) => {
    urls.push(url)
    return `\u0000URL${urls.length - 1}\u0000`
  })

  const stripped = withoutUrls
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    // Keep the target: "[the PDF](<link>)" must not throw the link away.
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2")
    .replace(/```[a-z]*\n([\s\S]*?)\n```/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*{1,2}([^*\n]+)\*{1,2}/g, "$1")
    // Emphasis only at word boundaries. Markdown does not italicise mid-word
    // underscores either, and filenames like Arka_Garai_29_PS2 depend on that.
    .replace(/(^|\s)_{1,2}([^_\n]+)_{1,2}(?=$|\s|[.,!?;:])/gm, "$1$2")
    // Unwrap inline code — the old rule deleted its contents outright.
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return stripped.replace(/\u0000URL(\d+)\u0000/g, (_m, i) => urls[Number(i)] ?? "")
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
