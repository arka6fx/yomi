// Connector interface — all integration connectors implement this

export interface EmailSummary {
  id: string
  threadId: string
  subject: string
  from: string
  date: string
  snippet: string
  isRead: boolean
  labels: string[]
}

export interface EmailDetail extends EmailSummary {
  to: string[]
  cc: string[]
  bcc: string[]
  body: string // plain-text decoded body
  htmlBody?: string
}

export interface EmailDraft {
  to: string[]
  subject: string
  body: string
  cc?: string[]
  bcc?: string[]
  replyToMessageId?: string
}

export interface SendResult {
  messageId: string
  threadId: string
}

// Resolves a valid (auto-refreshed) access token for a user+provider. Injected
// so the same connectors run in the sidecar (HTTP to backend) and the backend
// (in-process DB lookup) without code changes.
export type TokenProvider = (userId: string, provider: string) => Promise<string>

// Lists the providers a user has connected. Injected for the same reason.
export type ConnectedProvidersLister = (userId: string) => Promise<string[]>

// Base connector interface — every integration implements this
export interface Connector {
  readonly provider: string
  readonly displayName: string
  isConnected(): boolean
  // Gmail-style read/write
  searchEmails(query: string, limit?: number): Promise<EmailSummary[]>
  readEmail(messageId: string): Promise<EmailDetail>
  sendEmail(draft: EmailDraft): Promise<SendResult>
  getUnreadEmails(limit?: number): Promise<EmailSummary[]>
  // Returns a human-readable summary of the given message IDs (or last N unread)
  summarizeEmailsRaw(messageIds: string[]): Promise<EmailDetail[]>
}

export type ConnectorStatus =
  | { connected: true; displayName: string; lastSyncAt: string | null }
  | { connected: false }
