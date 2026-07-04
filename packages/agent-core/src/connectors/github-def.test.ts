import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createGitHubTools } from "./github-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string }[] = []

function tools() {
  return createGitHubTools({
    userId: "user_1",
    getAccessToken: async () => "github-token",
  })
}

function executeTool(name: string, args: Record<string, unknown>) {
  const tool = tools()[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" })

    if (String(input).includes("/notifications")) {
      return Response.json([
        {
          id: "1",
          unread: true,
          reason: "mention",
          updated_at: "2026-07-04T00:00:00Z",
          repository: { full_name: "arka6fx/yomi", html_url: "https://github.com/arka6fx/yomi" },
          subject: {
            title: "Fix Telegram connector response",
            type: "Issue",
            url: "https://api.github.com/repos/arka6fx/yomi/issues/1",
          },
          url: "https://api.github.com/notifications/threads/1",
        },
      ])
    }

    return Response.json({})
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("GitHub connector", () => {
  it("lists notifications from the account-level endpoint", async () => {
    const result = (await executeTool("github-listNotifications", {
      all: true,
      participating: true,
      limit: 5,
    })) as { count?: number; notifications?: { repository: string; subject: string }[] }

    expect(result.count).toBe(1)
    expect(result.notifications?.[0]).toMatchObject({
      repository: "arka6fx/yomi",
      subject: "Fix Telegram connector response",
    })
    expect(requests[0]?.url).toBe(
      "https://api.github.com/notifications?all=true&participating=true&per_page=5",
    )
  })
})
