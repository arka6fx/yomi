import { beforeEach, describe, expect, it, mock } from "bun:test"

const executeCalls: unknown[] = []
let executeImpl: (call: unknown) => unknown = () => ({ rows: [] })

mock.module("@yomi/db", () => ({
  db: {
    execute: (query: unknown) => {
      executeCalls.push(query)
      return Promise.resolve(executeImpl(query))
    },
  },
  agentSessions: {},
  agentMessages: {},
}))

const { listAgentSessions, getSessionDetail } = await import("./agent-sessions.js")

beforeEach(() => {
  executeCalls.length = 0
  executeImpl = () => ({ rows: [] })
})

describe("listAgentSessions", () => {
  it("returns closed sessions with their last message, newest first", async () => {
    executeImpl = () => ({
      rows: [
        {
          id: "session_2",
          title: "Connect Notion",
          summary: "Helped connect Notion.",
          messageCount: 4,
          platform: "telegram",
          lastMessageAt: "2026-08-14T10:00:00.000Z",
          closedAt: "2026-08-14T10:00:05.000Z",
          lastRole: "assistant",
          lastContent: "notion's connected now",
        },
      ],
    })

    const result = await listAgentSessions("user_1", { limit: 20 })

    expect(result).toEqual([
      {
        id: "session_2",
        title: "Connect Notion",
        summary: "Helped connect Notion.",
        messageCount: 4,
        platform: "telegram",
        lastMessageAt: "2026-08-14T10:00:00.000Z",
        closedAt: "2026-08-14T10:00:05.000Z",
        lastMessage: { role: "assistant", content: "notion's connected now" },
      },
    ])
  })

  it("returns a null lastMessage when a session has no messages", async () => {
    executeImpl = () => ({
      rows: [
        {
          id: "session_3",
          title: null,
          summary: null,
          messageCount: 0,
          platform: "telegram",
          lastMessageAt: "2026-08-14T10:00:00.000Z",
          closedAt: "2026-08-14T10:00:05.000Z",
          lastRole: null,
          lastContent: null,
        },
      ],
    })

    const result = await listAgentSessions("user_1", { limit: 20 })

    expect(result[0]!.lastMessage).toBeNull()
  })
})

describe("getSessionDetail", () => {
  it("returns the session header and its full ordered transcript", async () => {
    let call = 0
    executeImpl = () => {
      call++
      if (call === 1) {
        return {
          rows: [
            {
              id: "session_2",
              title: "Connect Notion",
              summary: "Helped connect Notion.",
              platform: "telegram",
              closedAt: "2026-08-14T10:00:05.000Z",
            },
          ],
        }
      }
      return {
        rows: [
          { role: "user", content: "connect notion", createdAt: "2026-08-14T09:59:00.000Z" },
          {
            role: "assistant",
            content: "notion's connected now",
            createdAt: "2026-08-14T10:00:00.000Z",
          },
        ],
      }
    }

    const result = await getSessionDetail("user_1", "session_2")

    expect(result).toEqual({
      id: "session_2",
      title: "Connect Notion",
      summary: "Helped connect Notion.",
      platform: "telegram",
      closedAt: "2026-08-14T10:00:05.000Z",
      messages: [
        { role: "user", content: "connect notion", createdAt: "2026-08-14T09:59:00.000Z" },
        {
          role: "assistant",
          content: "notion's connected now",
          createdAt: "2026-08-14T10:00:00.000Z",
        },
      ],
    })
  })

  it("returns null when the session doesn't belong to this user (or doesn't exist)", async () => {
    executeImpl = () => ({ rows: [] })

    const result = await getSessionDetail("user_1", "someone_elses_session")

    expect(result).toBeNull()
  })
})
