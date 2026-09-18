import type { PlatformType, GatewayMessage } from "@yomi/shared"

// A webhook-driven surface boots a fresh Worker isolate per update, and one-time
// bot setup costs several billed subrequests against a hard per-invocation cap.
// The webhook path passes `minimal` so connect() only guarantees the adapter can
// send and receive, leaving the setup chores to a real start (cron/standalone
// boot). Adapters must treat connect() as idempotent either way.
export interface ConnectOptions {
  minimal?: boolean
}

export interface PlatformAdapter {
  readonly platform: PlatformType
  connect(options?: ConnectOptions): Promise<void>
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
  setReaction(
    chatId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: boolean; error?: string }>
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// Converts the model's markdown into the small HTML tag set Telegram's `HTML`
// parse_mode supports (b/i/s/code/pre/a), instead of stripping formatting down to
// plain text. Code, links, and bare URLs are pulled out and rendered to their
// final form up front (same reasoning as removeMarkdown's URL handling above —
// underscores in Drive file IDs aren't emphasis) so the escaping and emphasis
// passes below never touch them, and never touch our own inserted tags either.
export function markdownToTelegramHtml(text: string): string {
  const codeBlocks: string[] = []
  let out = text.replace(/```[a-z]*\n([\s\S]*?)\n```/g, (_m, code: string) => {
    codeBlocks.push("<pre>" + escapeHtml(code) + "</pre>")
    return "TGCODEBLOCKMARK" + (codeBlocks.length - 1) + "END"
  })

  const inlineCode: string[] = []
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    inlineCode.push("<code>" + escapeHtml(code) + "</code>")
    return "TGCODEMARK" + (inlineCode.length - 1) + "END"
  })

  out = out.replace(/!\[([^\]]*)\]\([^)]+\)/g, "")

  const links: string[] = []
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText: string, url: string) => {
    links.push('<a href="' + escapeHtml(url) + '">' + escapeHtml(linkText) + "</a>")
    return "TGLINKMARK" + (links.length - 1) + "END"
  })

  const bareUrls: string[] = []
  out = out.replace(/https?:\/\/\S+/g, (url) => {
    bareUrls.push(escapeHtml(url))
    return "TGURLMARK" + (bareUrls.length - 1) + "END"
  })

  out = escapeHtml(out)

  out = out
    // Bullets first: a "* item" marker is a lone asterisk with no closing partner,
    // and resolving it before the italic pass keeps that asterisk from being read
    // as an unterminated emphasis marker that swallows the rest of the line.
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/(^|\s)\*([^*\n]+)\*(?=$|\s|[.,!?;:])/gm, "$1<i>$2</i>")
    .replace(/(^|\s)_([^_\n]+)_(?=$|\s|[.,!?;:])/gm, "$1<i>$2</i>")
    .replace(/~~([^~\n]+)~~/g, "<s>$1</s>")
    .replace(/^&gt;\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  out = out
    .replace(/TGURLMARK(\d+)END/g, (_m, i) => bareUrls[Number(i)] ?? "")
    .replace(/TGLINKMARK(\d+)END/g, (_m, i) => links[Number(i)] ?? "")
    .replace(/TGCODEBLOCKMARK(\d+)END/g, (_m, i) => codeBlocks[Number(i)] ?? "")
    .replace(/TGCODEMARK(\d+)END/g, (_m, i) => inlineCode[Number(i)] ?? "")

  return out
}

export function truncateMessage(text: string, maxLen = 2000): string {
  if (text.length <= maxLen) return text
  if (maxLen <= 0) return ""
  const suffix = "…"
  let end = maxLen - suffix.length
  if (end <= 0) return suffix
  const truncated = text.slice(0, end)
  const lastSpace = truncated.lastIndexOf(" ")
  if (lastSpace > Math.ceil(end * 0.5)) {
    return truncated.slice(0, lastSpace) + suffix
  }
  return truncated + suffix
}
