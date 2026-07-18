import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioContactsDef, contactsComposioSpecs, CONTACTS_TOOLKIT } from "./google-contacts.js"
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

describe("Contacts via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioContactsDef(fakeExecutor())
    expect(def.id).toBe("google-contacts")
    expect(def.name).toBe("Google Contacts")
    expect(def.category).toBe("productivity")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: CONTACTS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_CONTACTS_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioContactsDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLECONTACTS_LIST_CONTACTS"]).toBeDefined()
    expect(tools["GOOGLECONTACTS_CREATE_CONTACT"]).toBeDefined()
    expect(tools["GOOGLECONTACTS_DELETE_CONTACT"]).toBeDefined()
  })
})

describe("Contacts via Composio — read pass-through", () => {
  it("executes a Contacts read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ contacts: [{ id: "c1", name: "Alice" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-contacts",
      toolkit: CONTACTS_TOOLKIT,
      specs: contactsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLECONTACTS_LIST_CONTACTS"]!.execute({ page_size: 10 })

    expect(result).toEqual({ contacts: [{ id: "c1", name: "Alice" }] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLECONTACTS_LIST_CONTACTS", arguments: { page_size: 10 } },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Contacts via Composio — write gating", () => {
  it("routes a createContact write tool through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-contacts",
      toolkit: CONTACTS_TOOLKIT,
      specs: contactsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLECONTACTS_CREATE_CONTACT"]!.execute({
      name: "Alice",
      email: "alice@example.com",
    })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })
})
