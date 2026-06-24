import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { AgentMessage } from "@yomi/agent-core"
import type { PlatformAdapter } from "./platform-adapter.js"

let agentCalls: { userId: string; text: string; history?: AgentMessage[]; signal?: AbortSignal }[] = []
let loadedHistory: AgentMessage[] = []
let appendedTurns: { sessionId: string; userId: string; userText: string; assistantText: string }[] = []
let closedSessions: { userId: string; platform: string; chatId: string }[] = []
let pendingActions: { id: string; title: string; preview: string }[] = []
let approvedActions: string[] = []
let deniedActions: string[] = []

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
  runAgent: async ({
    userId,
    text,
    history,
    signal,
  }: {
    userId: string
    text: string
    history?: AgentMessage[]
    signal?: AbortSignal
  }) => {
    agentCalls.push({ userId, text, history, signal })
    return { text: "backend reply" }
  },
}))

mock.module("../services/agent-sessions.js", () => ({
  getOrCreateAgentSession: async () => ({ id: "session_1", messageCount: 0 }),
  loadAgentHistory: async () => loadedHistory,
  appendAgentTurn: async (input: {
    sessionId: string
    userId: string
    userText: string
    assistantText: string
  }) => {
    appendedTurns.push(input)
  },
  closeAgentSession: async (input: { userId: string; platform: string; chatId: string }) => {
    closedSessions.push(input)
  },
}))

mock.module("../services/pending-actions.js", () => ({
  listPendingActions: async () => pendingActions,
  approvePendingAction: async (_userId: string, id: string) => {
    approvedActions.push(id)
    return { id, status: "executed" }
  },
  denyPendingAction: async (_userId: string, id: string) => {
    deniedActions.push(id)
    return { id, status: "denied" }
  },
}))

mock.module("../services/transcription.js", () => ({
  transcribeAudioUrl: async () => "",
}))

const { GatewayRunner } = await import("./gateway-runner.js")

class FakeAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "telegram"
  messages: { chatId: string; text: string }[] = []
  handler: ((msg: GatewayMessage) => void | Promise<void>) | null = null
  async connect() {}
  async disconnect() {}
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void { this.handler = handler }
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
  loadedHistory = []
  appendedTurns = []
  closedSessions = []
  pendingActions = []
  approvedActions = []
  deniedActions = []
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

    expect(agentCalls).toEqual([
      { userId: "user_1", text: "search my notion notes", history: [], signal: agentCalls[0]?.signal },
    ])
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
    expect(appendedTurns).toEqual([
      { sessionId: "session_1", userId: "user_1", userText: "search my notion notes", assistantText: "backend reply" },
    ])
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

    expect(agentCalls).toEqual([
      { userId: "user_1", text: "take a screenshot", history: [], signal: agentCalls[0]?.signal },
    ])
    await expect(runner.getPendingMessages("user_1")).resolves.toHaveLength(0)
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
  })

  it("loads persisted session history for backend agent context", async () => {
    loadedHistory = [
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
    ]
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "continue",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls[0]?.history).toEqual(loadedHistory)
  })

  it("closes the active persisted session for /new", async () => {
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/new",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toHaveLength(0)
    expect(closedSessions).toEqual([{ userId: "user_1", platform: "telegram", chatId: "chat_1" }])
    expect(adapter.messages.at(-1)?.text).toBe("Started a new conversation. How can I help you?")
  })

  it("shows pending approvals for /approve when multiple actions exist", async () => {
    pendingActions = [
      { id: "11111111-1111-1111-1111-111111111111", title: "Send email", preview: "To: a@example.com" },
      { id: "22222222-2222-2222-2222-222222222222", title: "Create event", preview: "Tomorrow" },
    ]
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/approve",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toHaveLength(0)
    expect(approvedActions).toHaveLength(0)
    expect(adapter.messages.at(-1)?.text).toContain("Send email")
    expect(adapter.messages.at(-1)?.text).toContain("Create event")
  })

  it("approves the only pending action with /approve", async () => {
    pendingActions = [
      { id: "11111111-1111-1111-1111-111111111111", title: "Send email", preview: "To: a@example.com" },
    ]
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/approve",
      timestamp: new Date().toISOString(),
    })

    expect(approvedActions).toEqual(["11111111-1111-1111-1111-111111111111"])
    expect(adapter.messages.at(-1)?.text).toBe("Approved and executed.")
  })
})
