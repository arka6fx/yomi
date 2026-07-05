import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.SLACK_CLIENT_ID = "slack_test_id"
  process.env.SLACK_CLIENT_SECRET = "slack_test_secret"
  process.env.BETTER_AUTH_BASE_URL = "http://localhost:3001"
  process.env.BETTER_AUTH_URL = "http://localhost:3000"
  process.env.ENCRYPTION_KEY = "03f5c50ad7461b5172d57041fef789cc7297c9bfd806a52eecba14e03201d040"
})

afterAll(() => {
  process.env = { ...originalEnv }
})

describe.skip("Slack connector def", () => {
  beforeAll(async () => {
    await import("./slack.js")
  })

  it("1. env vars are set", () => {
    expect(process.env.SLACK_CLIENT_ID).toBeTruthy()
    expect(process.env.SLACK_CLIENT_SECRET).toBeTruthy()
  })

  it("2. connector is registered", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("slack")
    expect(def).toBeDefined()
    expect(def?.id).toBe("slack")
    expect(def?.auth.clientIdEnv).toBe("SLACK_CLIENT_ID")
    expect(def?.auth.redirectPath).toBe("/api/integrations/callback/slack")
    expect(def?.auth.scopes).toEqual([])
    expect(def?.auth.extraAuthParams).toEqual({
      user_scope: "search:read channels:read users:read chat:write",
    })
  })

  it("3. tools function is defined", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("slack")
    expect(def?.tools).toBeFunction()
  })
})

describe.skip("Slack backend wrapper", () => {
  beforeAll(async () => {
    await import("./slack.js")
  })

  it("4. getDisplayName fetches team name", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("slack")
    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true, team: "Acme Corp", user: "alice" })),
    )
    const name = await def?.getDisplayName?.("xoxp_fake")
    expect(name).toBe("alice (Acme Corp)")
    mock.restore()
  })

  it("5. getDisplayName falls back on API error", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("slack")
    global.fetch = mock(async () => new Response("Unauthorized", { status: 401 }))
    const name = await def?.getDisplayName?.("xoxp_fake")
    expect(name).toBe("Slack")
    mock.restore()
  })
})

describe.skip("Slack tools", () => {
  let slackTools: Record<string, any>

  beforeAll(async () => {
    await import("./slack.js")
  })

  beforeEach(async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("slack")
    const context = {
      userId: "test-user-123",
      getAccessToken: async () => "xoxp_fake_token",
    }
    slackTools = def?.tools(context) ?? {}
  })

  afterEach(() => {
    mock.restore()
  })

  it("6. slack.listChannels returns channels", async () => {
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            channels: [
              {
                id: "C001",
                name: "general",
                is_member: true,
                num_members: 42,
                topic: { value: "General chat" },
              },
              {
                id: "C002",
                name: "random",
                is_member: false,
                num_members: 15,
                topic: { value: "" },
              },
            ],
          }),
        ),
    )
    const result = await slackTools["slack.listChannels"].execute!({ limit: 20 })
    expect(result.count).toBe(2)
    expect(result.channels[0].name).toBe("general")
    expect(result.channels[0].joined).toBeTrue()
    expect(result.channels[0].topic).toBe("General chat")
  })

  it("7. slack.listChannels handles empty result", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify({ ok: true, channels: [] })))
    const result = await slackTools["slack.listChannels"].execute!({ limit: 20 })
    expect(result.count).toBe(0)
  })

  it("8. slack.searchMessages returns results", async () => {
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            messages: {
              matches: [
                {
                  ts: "1234567890.123456",
                  text: "Hello world",
                  username: "alice",
                  channel: { id: "C001", name: "general" },
                  permalink: "https://slack.com/archives/C001/p123456",
                },
              ],
            },
          }),
        ),
    )
    const result = await slackTools["slack.searchMessages"].execute!({ query: "hello", limit: 10 })
    expect(result.count).toBe(1)
    expect(result.results[0].text).toBe("Hello world")
    expect(result.results[0].channel).toBe("general")
  })

  it("9. slack.searchMessages returns empty message when no results", async () => {
    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true, messages: { matches: [] } })),
    )
    const result = await slackTools["slack.searchMessages"].execute!({ query: "zzz", limit: 10 })
    expect(result.message).toInclude("No results found")
  })

  it("10. slack.listUsers returns workspace members", async () => {
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            members: [
              {
                id: "U001",
                name: "alice",
                real_name: "Alice Smith",
                profile: { display_name: "alice", image_72: "https://..." },
                deleted: false,
                is_bot: false,
              },
              {
                id: "U002",
                name: "bob",
                real_name: "Bob Jones",
                profile: { display_name: "", image_72: null },
                deleted: false,
                is_bot: false,
              },
              {
                id: "U003",
                name: "slackbot",
                real_name: "",
                profile: {},
                deleted: false,
                is_bot: true,
              },
            ],
          }),
        ),
    )
    const result = await slackTools["slack.listUsers"].execute!({ limit: 20 })
    expect(result.count).toBe(2)
    expect(result.members[0].name).toBe("Alice Smith")
    expect(result.members[0].id).toBe("U001")
    expect(result.members[0].avatar).toBe("https://...")
    expect(result.members[1].name).toBe("Bob Jones")
    const botInResult = result.members.some((m: any) => m.id === "U003")
    expect(botInResult).toBeFalse()
  })

  it("11. slack.listUsers excludes deleted users", async () => {
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            members: [
              {
                id: "U001",
                name: "alice",
                real_name: "Alice",
                profile: {},
                deleted: false,
                is_bot: false,
              },
              {
                id: "U002",
                name: "former",
                real_name: "Former",
                profile: {},
                deleted: true,
                is_bot: false,
              },
            ],
          }),
        ),
    )
    const result = await slackTools["slack.listUsers"].execute!({ limit: 20 })
    expect(result.count).toBe(1)
  })

  it("12. slack.sendMessage sends to channel", async () => {
    global.fetch = mock(
      async () =>
        new Response(JSON.stringify({ ok: true, channel: "C001", ts: "1700000000.000001" })),
    )
    const result = await slackTools["slack.sendMessage"].execute!({
      channel: "#general",
      text: "Hello!",
    })
    expect(result.ok).toBeTrue()
    expect(result.channel).toBe("C001")
    expect(result.ts).toBeTruthy()
  })

  it("13. tools pass Bearer token in Authorization header", async () => {
    let authHeader: string | undefined
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      authHeader = (init?.headers as Record<string, string>)?.["Authorization"]
      return new Response(JSON.stringify({ ok: true, channels: [] }))
    })
    await slackTools["slack.listChannels"].execute!({ limit: 20 })
    expect(authHeader).toBe("Bearer xoxp_fake_token")
  })

  it("14. Slack API error returns structured error", async () => {
    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: false, error: "not_authorized" })),
    )
    const result = await slackTools["slack.listChannels"].execute!({ limit: 20 })
    expect(result.error).toInclude("not_authorized")
  })
})
