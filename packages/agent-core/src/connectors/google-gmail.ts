import type {
  Connector,
  EmailAttachment,
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

// Attachments hang off nested multipart/* parts, at any depth. Nothing used to walk
// for them, so readEmail never reported any — which left gmail-saveAttachmentToDrive
// unreachable, since the agent had no attachmentId to pass it.
export function extractAttachments(payload: GmailPayload): EmailAttachment[] {
  const out: EmailAttachment[] = []
  const walk = (part: GmailPayload) => {
    const id = part.body?.attachmentId
    // A part with an attachmentId and a filename is a real attachment. Inline images
    // pasted into the body carry an attachmentId too but usually no filename, so they
    // are skipped — the user did not "attach" those.
    if (id && part.filename) {
      out.push({
        attachmentId: id,
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body?.size,
      })
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)
  return out
}

function header(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
}

// Strip CR/LF (and fold whitespace) from any value placed on a header line.
// Reply headers reuse the ORIGINAL message's To/Subject/References, which are
// attacker-controlled — without this, a crafted incoming email could inject
// extra headers (e.g. a hidden Bcc) into Yomi's outgoing reply.
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function headerList(headers: GmailHeader[], name: string): string[] {
  const val = header(headers, name)
  if (!val) return []
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

interface GmailHeader {
  name: string
  value: string
}

interface GmailPayload {
  mimeType?: string
  headers?: GmailHeader[]
  filename?: string
  body?: { data?: string; size?: number; attachmentId?: string }
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

interface GmailThread {
  id: string
  historyId?: string
  messages?: GmailMessage[]
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
      attachments: msg.payload ? extractAttachments(msg.payload) : [],
    }
  }

  async getUnreadEmails(limit = 10): Promise<EmailSummary[]> {
    return this.searchEmails("is:unread in:inbox", limit)
  }

  async summarizeEmailsRaw(messageIds: string[]): Promise<EmailDetail[]> {
    return Promise.all(messageIds.map((id) => this.readEmail(id)))
  }

  private async modifyMessage(
    messageId: string,
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
  ): Promise<void> {
    await this.gmail<GmailMessage>(`/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    })
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.modifyMessage(messageId, [], ["UNREAD"])
  }

  async markAsUnread(messageId: string): Promise<void> {
    await this.modifyMessage(messageId, ["UNREAD"], [])
  }

  async archiveEmail(messageId: string): Promise<void> {
    await this.modifyMessage(messageId, [], ["INBOX"])
  }

  async trashEmail(messageId: string): Promise<void> {
    await this.gmail<GmailMessage>(`/messages/${messageId}/trash`, { method: "POST" })
  }

  // Reply within the original thread: In-Reply-To/References headers plus the
  // matching "Re:" subject are what make threading work outside Gmail too.
  async replyToThread(reply: {
    messageId: string
    body: string
    cc?: string[]
    bcc?: string[]
  }): Promise<SendResult & { to: string; subject: string }> {
    const orig = await this.gmail<GmailMessage>(`/messages/${reply.messageId}?format=metadata`)
    const hdrs = orig.payload?.headers ?? []
    const origMessageId = sanitizeHeaderValue(header(hdrs, "Message-ID"))
    const origSubject = sanitizeHeaderValue(header(hdrs, "Subject"))
    const subject = /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`
    const to = sanitizeHeaderValue(header(hdrs, "Reply-To") || header(hdrs, "From"))
    if (!to) throw new Error("Original message has no sender to reply to")
    const references = [sanitizeHeaderValue(header(hdrs, "References")), origMessageId]
      .filter(Boolean)
      .join(" ")

    const lines = [
      `To: ${to}`,
      reply.cc?.length ? `Cc: ${reply.cc.map(sanitizeHeaderValue).join(", ")}` : null,
      reply.bcc?.length ? `Bcc: ${reply.bcc.map(sanitizeHeaderValue).join(", ")}` : null,
      `Subject: ${subject}`,
      origMessageId ? `In-Reply-To: ${origMessageId}` : null,
      references ? `References: ${references}` : null,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      reply.body,
    ].filter((l) => l !== null)

    const encoded = Buffer.from(lines.join("\r\n")).toString("base64url")
    const sent = await this.gmail<GmailMessage>("/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: encoded, threadId: orig.threadId }),
    })
    return { messageId: sent.id, threadId: sent.threadId, to, subject }
  }

  async getThread(threadId: string): Promise<{ id: string; messages: EmailDetail[] }> {
    const thread = await this.gmail<GmailThread>(`/threads/${threadId}?format=full`)
    const messages = await Promise.all(
      (thread.messages ?? []).map(async (msg) => {
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
          attachments: msg.payload ? extractAttachments(msg.payload) : [],
        } satisfies EmailDetail
      }),
    )
    return { id: thread.id, messages }
  }

  async listLabels(): Promise<{ id: string; name: string; type: string }[]> {
    const data = await this.gmail<{ labels?: { id: string; name: string; type: string }[] }>(
      "/labels",
    )
    return data.labels ?? []
  }

  async applyLabels(
    messageId: string,
    addLabelIds: string[],
    removeLabelIds: string[],
  ): Promise<void> {
    await this.modifyMessage(messageId, addLabelIds, removeLabelIds)
  }

  async createDraft(draft: EmailDraft): Promise<{ id: string; messageId: string }> {
    const to = draft.to.map(sanitizeHeaderValue).join(", ")
    const cc = draft.cc?.map(sanitizeHeaderValue).join(", ") ?? ""
    const bcc = draft.bcc?.map(sanitizeHeaderValue).join(", ") ?? ""
    const lines = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      bcc ? `Bcc: ${bcc}` : null,
      `Subject: ${sanitizeHeaderValue(draft.subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      draft.body,
    ].filter((l) => l !== null)

    const rawMsg = lines.join("\r\n")
    const encoded = Buffer.from(rawMsg).toString("base64url")

    const body: Record<string, unknown> = { message: { raw: encoded } }
    if (draft.replyToMessageId) {
      try {
        const orig = await this.gmail<GmailMessage>(
          `/messages/${draft.replyToMessageId}?format=metadata`,
        )
        ;(body.message as Record<string, string>).threadId = orig.threadId
      } catch {
        /* best-effort */
      }
    }

    const result = await this.gmail<{ id: string; message: { id: string } }>("/drafts", {
      method: "POST",
      body: JSON.stringify(body),
    })
    return { id: result.id, messageId: result.message.id }
  }

  async getAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ filename: string; mimeType: string; data: string; size: number }> {
    const msg = await this.gmail<GmailMessage>(`/messages/${messageId}?format=full`)
    const findAttachment = (payload: GmailPayload): GmailPayload | null => {
      if (payload.body?.attachmentId) {
        const found = payload.parts?.find((p) => p.body?.attachmentId === attachmentId)
        return found ?? null
      }
      if (payload.parts) {
        for (const part of payload.parts) {
          const found = findAttachment(part)
          if (found) return found
        }
      }
      return null
    }
    const part = msg.payload ? findAttachment(msg.payload) : null
    const att = await this.gmail<{ attachmentId: string; data: string; size: number }>(
      `/messages/${messageId}/attachments/${attachmentId}`,
    )
    return {
      filename: part?.filename ?? "attachment",
      mimeType: part?.mimeType ?? "application/octet-stream",
      data: att.data,
      size: att.size,
    }
  }

  async listDrafts(): Promise<
    { id: string; messageId: string; subject: string; from: string; date: string }[]
  > {
    const data = await this.gmail<{
      drafts?: { id: string; message: { id: string } }[]
      resultSizeEstimate?: number
    }>("/drafts")
    const draftIds = data.drafts ?? []
    return Promise.all(
      draftIds.map(async (d) => {
        try {
          const detail = await this.gmail<GmailMessage>(`/drafts/${d.id}?format=metadata`)
          const hdrs = detail.payload?.headers ?? []
          return {
            id: d.id,
            messageId: detail.id,
            subject: header(hdrs, "Subject") || "(no subject)",
            from: header(hdrs, "From") || "",
            date: header(hdrs, "Date") || new Date(Number(detail.internalDate ?? 0)).toISOString(),
          }
        } catch {
          return { id: d.id, messageId: d.message.id, subject: "(unknown)", from: "", date: "" }
        }
      }),
    )
  }

  async sendDraft(draftId: string): Promise<SendResult> {
    const result = await this.gmail<{ id: string; message: { id: string; threadId: string } }>(
      `/drafts/send`,
      { method: "POST", body: JSON.stringify({ id: draftId }) },
    )
    return { messageId: result.message.id, threadId: result.message.threadId }
  }

  async createLabel(
    name: string,
    labelVisibility?: string,
    messageVisibility?: string,
  ): Promise<{ id: string; name: string; type: string }> {
    const label = await this.gmail<{ id: string; name: string; type: string }>("/labels", {
      method: "POST",
      body: JSON.stringify({
        name,
        labelListVisibility: labelVisibility ?? "labelShow",
        messageListVisibility: messageVisibility ?? "show",
      }),
    })
    return { id: label.id, name: label.name, type: label.type }
  }

  async sendEmail(draft: EmailDraft): Promise<SendResult> {
    // Construct RFC 2822 message
    const to = draft.to.map(sanitizeHeaderValue).join(", ")
    const cc = draft.cc?.map(sanitizeHeaderValue).join(", ") ?? ""
    const bcc = draft.bcc?.map(sanitizeHeaderValue).join(", ") ?? ""
    const lines = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      bcc ? `Bcc: ${bcc}` : null,
      `Subject: ${sanitizeHeaderValue(draft.subject)}`,
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
        const orig = await this.gmail<GmailMessage>(
          `/messages/${draft.replyToMessageId}?format=metadata`,
        )
        body.threadId = orig.threadId
      } catch {
        /* best-effort */
      }
    }

    const sent = await this.gmail<GmailMessage>("/messages/send", {
      method: "POST",
      body: JSON.stringify(body),
    })

    return { messageId: sent.id, threadId: sent.threadId }
  }
}
