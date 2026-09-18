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

function webhookRequest(updateId = 1): Request {
  return new Request(`http://test/telegram/webhook/${BOT_TOKEN}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": SECRET,
    },
    body: JSON.stringify({
      update_id: updateId,
      message: { message_id: updateId, chat: { id: 1, type: "private" }, text: "hi" },
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

  it(
    "does not reprocess the same update_id delivered twice (e.g. a Telegram retry)",
    async () => {
      const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} }

      const first = await gatewayRouter.fetch(webhookRequest(42), {}, execCtx as never)
      const second = await gatewayRouter.fetch(webhookRequest(42), {}, execCtx as never)

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(processedUpdates).toHaveLength(1)
    },
    { timeout: 1500 },
  )

  it(
    "still processes a different update_id normally after seeing an earlier one",
    async () => {
      const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} }

      await gatewayRouter.fetch(webhookRequest(43), {}, execCtx as never)
      await gatewayRouter.fetch(webhookRequest(44), {}, execCtx as never)

      expect(processedUpdates).toHaveLength(2)
    },
    { timeout: 1500 },
  )

  it(
    "enqueues the update to the TELEGRAM_INBOX queue when the binding exists",
    async () => {
      const sent: unknown[] = []
      const queue = { send: (u: unknown) => { sent.push(u); return Promise.resolve() } }
      const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} }

      // update_id 50 is distinct from the seen set used above.
      const res = await gatewayRouter.fetch(
        webhookRequest(50),
        { TELEGRAM_INBOX: queue },
        execCtx as never,
      )

      expect(res.status).toBe(200)
      expect(sent).toHaveLength(1)
      // Queue present -> nothing handed to the in-isolate background path.
      expect(processedUpdates).toHaveLength(0)
    },
    { timeout: 1500 },
  )

  it(
    "falls back to background processing when the queue send fails",
    async () => {
      const queue = { send: () => Promise.reject(new Error("queue down")) }
      const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} }

      const res = await gatewayRouter.fetch(
        webhookRequest(51),
        { TELEGRAM_INBOX: queue },
        execCtx as never,
      )

      expect(res.status).toBe(200)
      expect(processedUpdates).toHaveLength(1)
    },
    { timeout: 1500 },
  )

  it(
    "does not enqueue a duplicate update_id twice",
    async () => {
      const sent: unknown[] = []
      const queue = { send: (u: unknown) => { sent.push(u); return Promise.resolve() } }
      const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} }

      const first = await gatewayRouter.fetch(
        webhookRequest(60),
        { TELEGRAM_INBOX: queue },
        execCtx as never,
      )
      const second = await gatewayRouter.fetch(
        webhookRequest(60),
        { TELEGRAM_INBOX: queue },
        execCtx as never,
      )

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(sent).toHaveLength(1)
    },
    { timeout: 1500 },
  )
})
