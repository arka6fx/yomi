import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createGmailTools, googleGmailDef } from "./google-gmail-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string; auth: string; body: unknown }[] = []

function tools() {
  return createGmailTools({
    userId: "user_1",
    getAccessToken: async (_userId, provider) =>
      provider === "google-drive" ? "drive-token" : "gmail-token",
  })
}

function executeTool(name: string, args: Record<string, unknown>) {
  const tool = tools()[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

const originalMessage = {
  id: "msg_1",
  threadId: "thread_1",
  labelIds: ["INBOX"],
  payload: {
    headers: [
      { name: "Subject", value: "Quarterly report" },
      { name: "From", value: "Boss <boss@example.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Date", value: "Thu, 9 Jul 2026 10:00:00 +0000" },
      { name: "Message-ID", value: "<orig-123@mail.example.com>" },
      { name: "References", value: "<root-1@mail.example.com>" },
    ],
  },
}

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    requests.push({
      url,
      method: init?.method ?? "GET",
      auth: headers.get("Authorization") ?? "",
      body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : init?.body,
    })

    if (url.includes("/messages/send")) {
      return Response.json({ id: "sent_1", threadId: "thread_1" })
    }
    if (url.includes("/attachments/")) {
      // "hi" in base64url
      return Response.json({ attachmentId: "att_1", data: "aGk=", size: 2 })
    }
    if (url.includes("/messages/msg_1")) {
      return Response.json(originalMessage)
    }
    if (url.includes("/messages?q=")) {
      return Response.json({ messages: [{ id: "msg_1", threadId: "thread_1" }] })
    }
    if (url.includes("upload/drive/v3/files")) {
      return Response.json({
        id: "drive_1",
        name: "report.pdf",
        webViewLink: "https://drive.google.com/file/d/drive_1",
      })
    }
    return Response.json({})
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("gmail-replyToThread", () => {
  it("sends an RFC-2822 reply with threading headers and Re: subject", async () => {
    const result = (await executeTool("gmail-replyToThread", {
      messageId: "msg_1",
      body: "Sounds good, will do.",
    })) as { ok?: boolean; threadId?: string }

    expect(result.ok).toBe(true)
    expect(result.threadId).toBe("thread_1")

    const send = requests.find((r) => r.url.includes("/messages/send"))
    expect(send?.method).toBe("POST")
    const sendBody = send?.body as { raw: string; threadId: string }
    expect(sendBody.threadId).toBe("thread_1")
    const raw = Buffer.from(sendBody.raw, "base64url").toString("utf8")
    expect(raw).toContain("To: Boss <boss@example.com>")
    expect(raw).toContain("Subject: Re: Quarterly report")
    expect(raw).toContain("In-Reply-To: <orig-123@mail.example.com>")
    expect(raw).toContain("References: <root-1@mail.example.com> <orig-123@mail.example.com>")
    expect(raw).toContain("Sounds good, will do.")
  })

  it("strips CRLF from attacker-controlled headers (no header injection)", async () => {
    originalMessage.payload.headers[1] = {
      name: "From",
      value: "attacker@evil.com\r\nBcc: victim@example.com",
    }
    originalMessage.payload.headers[0] = {
      name: "Subject",
      value: "Hi\r\nX-Injected: 1",
    }
    await executeTool("gmail-replyToThread", { messageId: "msg_1", body: "ok" })
    const send = requests.find((r) => r.url.includes("/messages/send"))
    const raw = Buffer.from((send?.body as { raw: string }).raw, "base64url").toString("utf8")
    const headerLines = raw.split("\r\n\r\n")[0]!.split("\r\n")
    // No CRLF-injected header lines — the payload folds into the To value instead.
    expect(headerLines.some((l) => /^Bcc:/i.test(l))).toBe(false)
    expect(headerLines.some((l) => /^X-Injected:/i.test(l))).toBe(false)
    expect(raw).toContain("To: attacker@evil.com Bcc: victim@example.com") // folded to one line
    originalMessage.payload.headers[0] = { name: "Subject", value: "Quarterly report" }
    originalMessage.payload.headers[1] = { name: "From", value: "Boss <boss@example.com>" }
  })

  it("does not double-prefix an existing Re: subject", async () => {
    originalMessage.payload.headers[0] = { name: "Subject", value: "Re: Quarterly report" }
    await executeTool("gmail-replyToThread", { messageId: "msg_1", body: "ok" })
    const send = requests.find((r) => r.url.includes("/messages/send"))
    const raw = Buffer.from((send?.body as { raw: string }).raw, "base64url").toString("utf8")
    expect(raw).toContain("Subject: Re: Quarterly report")
    expect(raw).not.toContain("Re: Re:")
    originalMessage.payload.headers[0] = { name: "Subject", value: "Quarterly report" }
  })
})

describe("gmail-getImportantEmails", () => {
  it("queries Gmail's importance markers scoped to the inbox", async () => {
    const result = (await executeTool("gmail-getImportantEmails", {
      limit: 5,
      unreadOnly: false,
    })) as { count?: number }
    expect(result.count).toBe(1)
    const list = requests.find((r) => r.url.includes("/messages?q="))
    expect(decodeURIComponent(list?.url ?? "")).toContain("is:important in:inbox")
  })

  it("restricts to unread when unreadOnly is set", async () => {
    await executeTool("gmail-getImportantEmails", { limit: 5, unreadOnly: true })
    const list = requests.find((r) => r.url.includes("/messages?q="))
    expect(decodeURIComponent(list?.url ?? "")).toContain("is:important is:unread in:inbox")
  })
})

describe("gmail-saveAttachmentToDrive", () => {
  it("downloads via the gmail token and uploads via the drive token", async () => {
    const result = (await executeTool("gmail-saveAttachmentToDrive", {
      messageId: "msg_1",
      attachmentId: "att_1",
    })) as { ok?: boolean; id?: string; link?: string }

    expect(result.ok).toBe(true)
    expect(result.id).toBe("drive_1")
    expect(result.link).toContain("drive.google.com")

    const attachment = requests.find((r) => r.url.includes("/attachments/att_1"))
    expect(attachment?.auth).toBe("Bearer gmail-token")
    const upload = requests.find((r) => r.url.includes("upload/drive/v3/files"))
    expect(upload?.method).toBe("POST")
    expect(upload?.auth).toBe("Bearer drive-token")
  })

  it("returns a connect hint when Drive is not connected", async () => {
    const gmailOnly = createGmailTools({
      userId: "user_1",
      getAccessToken: async (_userId, provider) => {
        if (provider === "google-drive") throw new Error("not connected")
        return "gmail-token"
      },
    })
    const tool = gmailOnly["gmail-saveAttachmentToDrive"] as {
      execute: (args: Record<string, unknown>) => Promise<unknown>
    }
    const result = (await tool.execute({ messageId: "msg_1", attachmentId: "att_1" })) as {
      error?: string
      hint?: string
    }
    expect(result.error).toContain("not connected")
    expect(result.hint).toContain("connect Google Drive")
  })
})

describe("gmail def surface", () => {
  it("no longer offers permanent deletion or the full-mailbox scope", () => {
    expect(Object.keys(tools())).not.toContain("gmail-deletePermanently")
    const scopes = googleGmailDef.auth.kind === "oauth2" ? googleGmailDef.auth.scopes : []
    expect(scopes).not.toContain("https://mail.google.com/")
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.modify")
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.send")
  })
})
