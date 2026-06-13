import type {
  Connector,
  EmailSummary,
  EmailDetail,
  EmailDraft,
  SendResult,
  TokenProvider,
} from "./types.js"

// Decode a base64url or base64 encoded Gmail message part body
function decodeBody(data: string): string {
  if (!data) return ""
  // Gmail uses base64url encoding
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(base64, "base64").toString("utf8")
}

// Extract plain-text body from Gmail message payload recursively
function extractText(payload: GmailPayload): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBody(payload.body.data)
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractText(part)
      if (text) return text
    }
  }
  // fallback: text/html stripped
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBody(payload.body.data).replace(/<[^>]+>/g, "")
  }
  return ""
}

function extractHtml(payload: GmailPayload): string | undefined {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBody(payload.body.data)
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const html = extractHtml(part)
      if (html) return html
    }
  }
  return undefined
}

function header(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
}

function headerList(headers: GmailHeader[], name: string): string[] {
  const val = header(headers, name)
  if (!val) return []
  return val.split(",").map((s) => s.trim()).filter(Boolean)
}

interface GmailHeader {
  name: string
  value: string
}

interface GmailPayload {
  mimeType?: string
  headers?: GmailHeader[]
  body?: { data?: string; size?: number }
  parts?: GmailPayload[]
}

interface GmailMessage {
  id: string
  threadId: string
  snippet?: string
  labelIds?: string[]
  payload?: GmailPayload
  internalDate?: string
}

interface GmailListResponse {
  messages?: { id: string; threadId: string }[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export class GoogleGmailConnector implements Connector {
  readonly provider = "google"
  readonly displayName = "Google Gmail"

  // getAccessToken is injected so this connector works in both runtimes.
  constructor(
    private readonly userId: string,
    private readonly getAccessToken: TokenProvider,
  ) {}

  isConnected(): boolean {
    // Determined at runtime by the registry; always true when instantiated
    return true
  }

  private async gmail<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken(this.userId, "google")
    const base = "https://gmail.googleapis.com/gmail/v1/users/me"
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gmail API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  private async messageToSummary(msg: GmailMessage): Promise<EmailSummary> {
    const hdrs = msg.payload?.headers ?? []
    const dateVal = header(hdrs, "Date")
    return {
      id: msg.id,
      threadId: msg.threadId,
      subject: header(hdrs, "Subject") || "(no subject)",
      from: header(hdrs, "From") || "",
      date: dateVal || new Date(Number(msg.internalDate ?? 0)).toISOString(),
      snippet: msg.snippet ?? "",
      isRead: !(msg.labelIds ?? []).includes("UNREAD"),
      labels: (msg.labelIds ?? []).filter((l) => !["INBOX", "UNREAD"].includes(l)),
    }
  }

  async searchEmails(query: string, limit = 10): Promise<EmailSummary[]> {
    const list = await this.gmail<GmailListResponse>(
      `/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(limit, 20)}`,
    )
    const ids = list.messages?.slice(0, limit) ?? []
    return Promise.all(
      ids.map(async ({ id }) => {
        const msg = await this.gmail<GmailMessage>(`/messages/${id}?format=metadata`)
        return this.messageToSummary(msg)
      }),
    )
  }

  async readEmail(messageId: string): Promise<EmailDetail> {
    const msg = await this.gmail<GmailMessage>(`/messages/${messageId}?format=full`)
    const hdrs = msg.payload?.headers ?? []
    const dateVal = header(hdrs, "Date")
    return {
      id: msg.id,
      threadId: msg.threadId,
      subject: header(hdrs, "Subject") || "(no subject)",
      from: header(hdrs, "From") || "",
      to: headerList(hdrs, "To"),
      cc: headerList(hdrs, "Cc"),
      bcc: headerList(hdrs, "Bcc"),
      date: dateVal || new Date(Number(msg.internalDate ?? 0)).toISOString(),
      snippet: msg.snippet ?? "",
      isRead: !(msg.labelIds ?? []).includes("UNREAD"),
      labels: (msg.labelIds ?? []).filter((l) => !["INBOX", "UNREAD"].includes(l)),
      body: msg.payload ? extractText(msg.payload) : "",
      htmlBody: msg.payload ? extractHtml(msg.payload) : undefined,
    }
  }

  async getUnreadEmails(limit = 10): Promise<EmailSummary[]> {
    return this.searchEmails("is:unread in:inbox", limit)
  }

  async summarizeEmailsRaw(messageIds: string[]): Promise<EmailDetail[]> {
    return Promise.all(messageIds.map((id) => this.readEmail(id)))
  }

  async sendEmail(draft: EmailDraft): Promise<SendResult> {
    // Construct RFC 2822 message
    const to = draft.to.join(", ")
    const cc = draft.cc?.join(", ") ?? ""
    const bcc = draft.bcc?.join(", ") ?? ""
    const lines = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      bcc ? `Bcc: ${bcc}` : null,
      `Subject: ${draft.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      draft.body,
    ].filter((l) => l !== null)

    const rawMsg = lines.join("\r\n")
    const encoded = Buffer.from(rawMsg).toString("base64url")

    const body: Record<string, unknown> = { raw: encoded }
    if (draft.replyToMessageId) {
      // fetch threadId for reply threading
      try {
        const orig = await this.gmail<GmailMessage>(`/messages/${draft.replyToMessageId}?format=metadata`)
        body.threadId = orig.threadId
      } catch { /* best-effort */ }
    }

    const sent = await this.gmail<GmailMessage>("/messages/send", {
      method: "POST",
      body: JSON.stringify(body),
    })

    return { messageId: sent.id, threadId: sent.threadId }
  }
}
