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

const { createPendingAction } = await import("./pending-actions.js")

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
