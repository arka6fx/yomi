import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

// The approval card must be sent by the backend, not relayed by the model. The system
// prompt told the model to summarise "in one short line", so it compressed the
// recipient, subject and body out of existence and the user approved an email they had
// never seen. An approval gate that hides what it is approving is not a safety gate.
const sent: { chatId: string; text: string }[] = []

mock.module("../gateway/index.js", () => ({
  getDefaultGateway: () => ({
    sendMessage: async (_platform: string, chatId: string, text: string) => {
      sent.push({ chatId, text })
      return { ok: true }
    },
  }),
}))

const inserted: Record<string, unknown>[] = []

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v)
        return { returning: async () => [{ id: "pa_1", status: "pending" }] }
      },
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  },
  pendingActions: {},
}))

beforeEach(() => {
  sent.length = 0
  inserted.length = 0
})

afterEach(() => {
  mock.restore()
})

describe("approval card", () => {
  it("sends the full preview to the user before anything runs", async () => {
    const { createPendingAction } = await import("./pending-actions.js")

    await createPendingAction({
      userId: "user_1",
      connector: "google",
      action: "gmail-replyToThread",
      risk: "send",
      title: "Send reply to Alex <alex@example.com>",
      preview: "Reply to: Alex <alex@example.com>\n\nHi Alex, the slides will be ready by Sunday.",
      confirmText: "Send reply",
      payload: {},
      sourcePlatform: "telegram",
      sourceChatId: "chat_1",
    })

    expect(sent).toHaveLength(1)
    const card = sent[0]!.text
    // The user must be able to see WHO it goes to and WHAT it says, before approving.
    expect(card).toContain("alex@example.com")
    expect(card).toContain("the slides will be ready by Sunday")
    expect(card).toContain('Reply "yes" to approve')
  })

  it("does not try to send a card when there is no chat to send it to", async () => {
    const { createPendingAction } = await import("./pending-actions.js")

    await createPendingAction({
      userId: "user_1",
      connector: "google",
      action: "gmail-sendEmail",
      risk: "send",
      title: "Send email",
      preview: "To: someone@example.com",
      confirmText: "Send",
      payload: {},
    })

    expect(sent).toHaveLength(0)
  })
})
