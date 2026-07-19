import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioGmailDef, gmailComposioSpecs, GMAIL_TOOLKIT } from "./google-gmail.js"
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

describe("Gmail via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioGmailDef(fakeExecutor())
    expect(def.id).toBe("google")
    expect(def.name).toBe("Google Gmail")
    expect(def.category).toBe("email")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: GMAIL_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GMAIL_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioGmailDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GMAIL_FETCH_EMAILS"]).toBeDefined()
    expect(tools["GMAIL_SEND_EMAIL"]).toBeDefined()
    expect(tools["GMAIL_DELETE_MESSAGE"]).toBeDefined()
  })
})

describe("Gmail via Composio — read pass-through", () => {
  it("executes a Gmail read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ emails: [{ id: "abc123", subject: "Hello" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google",
      toolkit: GMAIL_TOOLKIT,
      specs: gmailComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GMAIL_FETCH_EMAILS"]!.execute({ query: "from:boss" })

    expect(result).toEqual({ emails: [{ id: "abc123", subject: "Hello" }] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GMAIL_FETCH_EMAILS", arguments: { query: "from:boss" } },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Gmail via Composio — write gating", () => {
  it("routes a sendEmail write tool through createPendingAction and does NOT call the executor", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google",
      toolkit: GMAIL_TOOLKIT,
      specs: gmailComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GMAIL_SEND_EMAIL"]!.execute({
      recipient_email: "alice@example.com",
      subject: "Hello",
      body: "How are you?",
    })

    expect(executor.calls).toEqual([])
    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({
      connector: "google",
      action: "GMAIL_SEND_EMAIL",
      risk: "send",
      title: "Send email to alice@example.com",
    })
    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("gates a delete action as irreversible", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p2", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google",
      toolkit: GMAIL_TOOLKIT,
      specs: gmailComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GMAIL_DELETE_MESSAGE"]!.execute({ message_id: "abc123" })

    expect((create.mock.calls[0]![0] as Record<string, unknown>)["risk"]).toBe("irreversible")
  })
})

describe("Gmail via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ ok: true, id: "sent-1" })
    const factory = createComposioTools({
      provider: "google",
      toolkit: GMAIL_TOOLKIT,
      specs: gmailComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["GMAIL_SEND_EMAIL"]!.execute({
      recipient_email: "bob@example.com",
      subject: "Replay",
      body: "Works",
    })

    expect(result).toEqual({ ok: true, id: "sent-1" })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "GMAIL_SEND_EMAIL",
        arguments: { recipient_email: "bob@example.com", subject: "Replay", body: "Works" },
      },
    ])
  })
})

describe("Gmail via Composio — error handling", () => {
  it("returns a structured connector error with reconnect hint when the executor fails", async () => {
    const executor: ComposioExecutor = {
      execute: async () => { throw new Error("Composio execute → status 401 unauthorized") },
    }
    const factory = createComposioTools({
      provider: "google",
      toolkit: GMAIL_TOOLKIT,
      specs: gmailComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = (await tools["GMAIL_FETCH_EMAILS"]!.execute({ query: "test" })) as {
      error: string
      hint?: string
    }

    expect(result.error).toContain("401")
    expect(result.hint).toContain("reconnect")
  })
})
