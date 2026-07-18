import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioSlackDef, slackComposioSpecs, SLACK_TOOLKIT } from "./slack.js"
import { createComposioTools } from "./adapter.js"
import type { ComposioExecutor } from "./adapter.js"

function fakeExecutor(result: unknown = { ok: true }): ComposioExecutor & {
  calls: { userId: string; slug: string; arguments: unknown }[]
} {
  const calls: { userId: string; slug: string; arguments: unknown }[] = []
  return {
    calls,
    execute: async (input) => {
      calls.push(input)
      return result
    },
  }
}

function buildCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    userId: "user_1",
    getAccessToken: async () => "unused-for-composio",
    ...overrides,
  }
}

describe("Slack via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioSlackDef(fakeExecutor())
    expect(def.id).toBe("slack")
    expect(def.name).toBe("Slack")
    expect(def.category).toBe("productivity")
    expect(def.readOnlyByDefault).toBe(true)
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: SLACK_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SLACK_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioSlackDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["SLACK_LIST_CONVERSATIONS"]).toBeDefined()
    expect(tools["SLACK_SEND_MESSAGE"]).toBeDefined()
    expect(tools["SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK"]).toBeDefined()
  })
})

describe("Slack via Composio — read pass-through", () => {
  it("executes a Slack read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ channels: [{ id: "C1", name: "general" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "slack",
      toolkit: SLACK_TOOLKIT,
      specs: slackComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["SLACK_LIST_CONVERSATIONS"]!.execute({
      limit: 10,
    })

    expect(result).toEqual({ channels: [{ id: "C1", name: "general" }] })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "SLACK_LIST_CONVERSATIONS",
        arguments: { limit: 10 },
      },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Slack via Composio — write gating", () => {
  it("routes a sendMessage write tool through createPendingAction and does NOT call the executor", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "slack",
      toolkit: SLACK_TOOLKIT,
      specs: slackComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["SLACK_SEND_MESSAGE"]!.execute({
      channel: "C1",
      markdown_text: "Hello from Yomi!",
    })

    expect(executor.calls).toEqual([])
    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({
      connector: "slack",
      action: "SLACK_SEND_MESSAGE",
      risk: "write",
      title: "Send Slack message to C1",
      payload: { channel: "C1", markdown_text: "Hello from Yomi!" },
    })
    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("gates an upload action as write", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p2", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "slack",
      toolkit: SLACK_TOOLKIT,
      specs: slackComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK"]!.execute({
      channels: "C1",
      content: "file content",
      filename: "test.txt",
    })

    expect((create.mock.calls[0]![0] as Record<string, unknown>)["risk"]).toBe("write")
  })
})

describe("Slack via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ ok: true, channel: "C1", ts: "12345.678" })
    const factory = createComposioTools({
      provider: "slack",
      toolkit: SLACK_TOOLKIT,
      specs: slackComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["SLACK_SEND_MESSAGE"]!.execute({
      channel: "C1",
      markdown_text: "Ship it",
    })

    expect(result).toEqual({ ok: true, channel: "C1", ts: "12345.678" })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "SLACK_SEND_MESSAGE",
        arguments: { channel: "C1", markdown_text: "Ship it" },
      },
    ])
  })
})

describe("Slack via Composio — error handling", () => {
  it("returns a structured connector error with reconnect hint when the executor fails", async () => {
    const executor: ComposioExecutor = {
      execute: async () => {
        throw new Error("Composio execute → status 401 unauthorized")
      },
    }
    const factory = createComposioTools({
      provider: "slack",
      toolkit: SLACK_TOOLKIT,
      specs: slackComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = (await tools["SLACK_LIST_CONVERSATIONS"]!.execute({
      limit: 10,
    })) as { error: string; hint?: string }

    expect(result.error).toContain("401")
    expect(result.hint).toContain("reconnect")
  })
})
