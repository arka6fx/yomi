import { describe, it, expect, beforeEach, mock } from "bun:test"

// The webhook must acknowledge Telegram immediately and process the update in
// the background. We model a processUpdate that never resolves on its own; the
// request must still return 200 without waiting for it.
const processedUpdates: unknown[] = []

class FakeTelegramAdapter {
  processUpdate(update: unknown): Promise<void> {
    processedUpdates.push(update)
    return new Promise<void>(() => {
      /* never resolves — simulates a slow/hung agent run */
    })
  }
}

mock.module("./platforms/telegram.js", () => ({ TelegramAdapter: FakeTelegramAdapter }))

const fakeGateway = {
  getAdapter: () => new FakeTelegramAdapter(),
  start: async () => {},
}
mock.module("./gateway-runner.js", () => ({ getDefaultGateway: () => fakeGateway }))
mock.module("../auth.js", () => ({ authenticate: async () => {} }))
mock.module("@yomi/db", () => ({ db: {}, platformConnections: {} }))

const { gatewayRouter } = await import("./routes.js")

const BOT_TOKEN = "123456:ABC_def-ghi"
const SECRET = BOT_TOKEN.replace(/[^A-Za-z0-9_-]/g, "")

beforeEach(() => {
  processedUpdates.length = 0
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN
})

function webhookRequest(): Request {
  return new Request(`http://test/telegram/webhook/${BOT_TOKEN}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": SECRET,
    },
    body: JSON.stringify({
      update_id: 1,
      message: { message_id: 1, chat: { id: 1, type: "private" }, text: "hi" },
    }),
  })
}

describe("Telegram webhook", () => {
  it(
    "returns 200 immediately and processes the update in the background",
    async () => {
      const waitUntilPromises: Promise<unknown>[] = []
      const execCtx = {
        waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
        passThroughOnException: () => {},
      }

      const res = await gatewayRouter.fetch(webhookRequest(), {}, execCtx as never)

      expect(res.status).toBe(200)
      expect(processedUpdates).toHaveLength(1)
      // The hung processUpdate must have been handed to waitUntil, not awaited.
      expect(waitUntilPromises).toHaveLength(1)
    },
    { timeout: 1500 },
  )
})
