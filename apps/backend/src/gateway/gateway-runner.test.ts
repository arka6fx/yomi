import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { PlatformAdapter } from "./platform-adapter.js"

let agentCalls: { userId: string; text: string }[] = []

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => ({
          then: (resolve: (rows: { id: string; userId: string }[]) => unknown) =>
            Promise.resolve(resolve([{ id: "conn_1", userId: "user_1" }])),
        }),
      }),
    }),
  }),
  insert: () => ({ values: () => Promise.resolve() }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  delete: () => ({ where: () => Promise.resolve() }),
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  platformConnections: { id: "id", userId: "userId", platform: "platform", platformUserId: "platformUserId", platformChatId: "platformChatId" },
  linkingCodes: {},
  telegramLinkTokens: {},
}))

mock.module("../agent/run.js", () => ({
  runAgent: async ({ userId, text }: { userId: string; text: string }) => {
    agentCalls.push({ userId, text })
    return { text: "backend reply" }
  },
}))

mock.module("../services/transcription.js", () => ({
  transcribeAudioUrl: async () => "",
}))

const { GatewayRunner } = await import("./gateway-runner.js")

class FakeAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "telegram"
  messages: { chatId: string; text: string }[] = []
  handler: ((msg: GatewayMessage) => void) | null = null
  async connect() {}
  async disconnect() {}
  setMessageHandler(handler: (msg: GatewayMessage) => void): void { this.handler = handler }
  async sendMessage(chatId: string, text: string) {
    this.messages.push({ chatId, text })
    return { ok: true }
  }
  async sendTyping() {}
}

function incoming(runner: GatewayRunner, msg: GatewayMessage) {
  return (runner as unknown as { onIncoming: (msg: GatewayMessage) => Promise<void> }).onIncoming(msg)
}

const originalFetch = globalThis.fetch

beforeEach(() => {
  agentCalls = []
  delete process.env.YOMI_GATEWAY_DIRECT_SIDECAR
  globalThis.fetch = (async () => {
    throw new Error("sidecar fetch should not run")
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("GatewayRunner production routing", () => {
  it("runs backend agent for normal Telegram messages without direct sidecar forwarding", async () => {
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    runner.setSidecarResolver(async () => "http://sidecar.invalid")
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "search my notion notes",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toEqual([{ userId: "user_1", text: "search my notion notes" }])
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
  })

  it("handles former desktop actions with the backend agent instead of queueing", async () => {
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "take a screenshot",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toEqual([{ userId: "user_1", text: "take a screenshot" }])
    await expect(runner.getPendingMessages("user_1")).resolves.toHaveLength(0)
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
  })
})
