import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectResult: { id: string; status: string }[] = []
let insertedRows: Record<string, unknown>[] = []
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(selectResult) }),
    }),
  }),
  insert: () => ({
    values: (row: Record<string, unknown>) => {
      insertedRows.push(row)
      return { returning: () => Promise.resolve([{ id: "action-1", status: "pending" }]) }
    },
  }),
}
mock.module("@yomi/db", () => ({ db: fakeDb, pendingActions: {} }))

let sentMessages: {
  platform: string
  chatId: string
  text: string
  options?: { buttons?: { text: string; callbackData: string }[][] }
}[] = []
mock.module("../gateway/index.js", () => ({
  getDefaultGateway: () => ({
    sendMessage: async (
      platform: string,
      chatId: string,
      text: string,
      options?: { buttons?: { text: string; callbackData: string }[][] },
    ) => {
      sentMessages.push({ platform, chatId, text, options })
      return { ok: true }
    },
  }),
}))

const { createPendingAction, formatActionResult } = await import("./pending-actions.js")

beforeEach(() => {
  selectResult = []
  insertedRows = []
  sentMessages = []
})

describe("createPendingAction", () => {
  it("attaches Approve/Deny inline buttons carrying the new action's id", async () => {
    await createPendingAction({
      userId: "user_1",
      connector: "google",
      action: "gmail.sendEmail",
      risk: "send",
      title: "Send email",
      preview: "To: a@example.com",
      payload: {},
      sourcePlatform: "telegram",
      sourceChatId: "chat_1",
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]?.platform).toBe("telegram")
    expect(sentMessages[0]?.chatId).toBe("chat_1")
    expect(sentMessages[0]?.options?.buttons).toEqual([
      [
        { text: "✅ Approve", callbackData: "approve:action-1" },
        { text: "❌ Deny", callbackData: "deny:action-1" },
      ],
    ])
  })

  it("sends no card when sourcePlatform/sourceChatId are missing", async () => {
    await createPendingAction({
      userId: "user_1",
      connector: "google",
      action: "gmail.sendEmail",
      risk: "send",
      title: "Send email",
      preview: "To: a@example.com",
      payload: {},
    })

    expect(sentMessages).toHaveLength(0)
  })

  it("sends no new card for a duplicate in-flight request for the same action", async () => {
    selectResult = [{ id: "existing-action", status: "pending" }]

    await createPendingAction({
      userId: "user_1",
      connector: "google",
      action: "gmail.sendEmail",
      risk: "send",
      title: "Send email",
      preview: "To: a@example.com",
      payload: {},
      sourcePlatform: "telegram",
      sourceChatId: "chat_1",
    })

    expect(sentMessages).toHaveLength(0)
    expect(insertedRows).toHaveLength(0)
  })
})

describe("formatActionResult", () => {
  it("extracts the human message from a raw upstream JSON error string", () => {
    const raw =
      'Notion API /pages → 400: {"object":"error","status":400,"code":"validation_error","message":"The request failed validation. Error: Person profile with ID f7d561d5-2512-825c-a0ba-81e76b8bb193 cannot have content","request_id":"24713916-3d10-4409-bc66-7265f6f4e3bd"}'

    const text = formatActionResult({ error: raw }, "fallback")

    expect(text).toBe(
      "That didn't work: The request failed validation. Error: Person profile with ID f7d561d5-2512-825c-a0ba-81e76b8bb193 cannot have content",
    )
  })

  it("extracts the message from a bare JSON error string with no prefix", () => {
    const raw = '{"error":"invalid_grant","error_description":"Token has been expired"}'

    const text = formatActionResult({ error: raw }, "fallback")

    expect(text).toBe("That didn't work: invalid_grant")
  })

  it("falls back to a truncated plain-text error when it isn't JSON at all", () => {
    const text = formatActionResult({ error: "network timeout" }, "fallback")

    expect(text).toBe("That didn't work: network timeout")
  })

  it("caps an unparseable error blob instead of dumping it whole", () => {
    const raw = "x".repeat(400)

    const text = formatActionResult({ error: raw }, "fallback")

    expect(text).toBe(`That didn't work: ${"x".repeat(200)}…`)
  })

  it("still returns the success message and link for a non-error result", () => {
    const text = formatActionResult({ message: "Done", link: "https://example.com" }, "fallback")

    expect(text).toBe("Done\nhttps://example.com")
  })
})
