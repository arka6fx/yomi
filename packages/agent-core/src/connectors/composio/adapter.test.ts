import { describe, expect, it, mock } from "bun:test"
import { z } from "zod"
import type { ConnectorContext } from "../connector-def.js"
import { createComposioTools } from "./adapter.js"
import type { ComposioExecutor, ComposioToolSpec } from "./adapter.js"

const specs: ComposioToolSpec[] = [
  {
    slug: "LINEAR_LIST_LINEAR_ISSUES",
    description: "List issues",
    parameters: z.object({ limit: z.number().optional() }),
  },
  {
    slug: "LINEAR_CREATE_LINEAR_ISSUE",
    description: "Create an issue",
    parameters: z.object({ title: z.string(), teamId: z.string() }),
    preview: (a) => ({ title: `Create issue: ${a.title}`, preview: a.title }),
  },
  {
    slug: "LINEAR_DELETE_LINEAR_ISSUE",
    description: "Delete an issue",
    parameters: z.object({ issueId: z.string() }),
  },
]

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

function toolsFor(executor: ComposioExecutor, ctx: ConnectorContext) {
  const factory = createComposioTools({
    provider: "linear",
    toolkit: "linear",
    specs,
    executor,
  })
  return factory(ctx) as Record<
    string,
    { execute: (args: unknown, opts?: unknown) => Promise<unknown> }
  >
}

describe("createComposioTools — approval-wrap adapter", () => {
  it("surfaces one tool per spec, keyed by Composio slug", () => {
    const tools = toolsFor(fakeExecutor(), buildCtx())
    expect(Object.keys(tools).sort()).toEqual([
      "LINEAR_CREATE_LINEAR_ISSUE",
      "LINEAR_DELETE_LINEAR_ISSUE",
      "LINEAR_LIST_LINEAR_ISSUES",
    ])
  })

  it("read tools call the Composio executor directly and return its result", async () => {
    const executor = fakeExecutor({ issues: [{ id: "1" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const tools = toolsFor(executor, buildCtx({ createPendingAction: create }))

    const result = await tools["LINEAR_LIST_LINEAR_ISSUES"]!.execute({ limit: 5 })

    expect(result).toEqual({ issues: [{ id: "1" }] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "LINEAR_LIST_LINEAR_ISSUES", arguments: { limit: 5 } },
    ])
    // a read must never queue an approval
    expect(create).not.toHaveBeenCalled()
  })

  it("write tools route through createPendingAction and do NOT execute remotely", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const tools = toolsFor(executor, buildCtx({ createPendingAction: create }))

    const result = await tools["LINEAR_CREATE_LINEAR_ISSUE"]!.execute({
      title: "Fix bug",
      teamId: "t1",
    })

    // no provider call happened
    expect(executor.calls).toEqual([])
    // it was queued with the right connector/action/risk/preview and payload
    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({
      connector: "linear",
      action: "LINEAR_CREATE_LINEAR_ISSUE",
      risk: "write",
      title: "Create issue: Fix bug",
      preview: "Fix bug",
      payload: { title: "Fix bug", teamId: "t1" },
    })
    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("gates unclassified/irreversible actions with the classified risk", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p2", status: "pending", message: "queued" }))
    const tools = toolsFor(executor, buildCtx({ createPendingAction: create }))

    await tools["LINEAR_DELETE_LINEAR_ISSUE"]!.execute({ issueId: "i1" })

    expect(executor.calls).toEqual([])
    expect((create.mock.calls[0]![0] as Record<string, unknown>)["risk"]).toBe("irreversible")
  })

  it("on approval replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ ok: true, id: "created-1" })
    // ctx WITHOUT createPendingAction mirrors the backend replay executor
    const tools = toolsFor(executor, buildCtx())

    const result = await tools["LINEAR_CREATE_LINEAR_ISSUE"]!.execute({
      title: "Ship it",
      teamId: "t1",
    })

    expect(result).toEqual({ ok: true, id: "created-1" })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "LINEAR_CREATE_LINEAR_ISSUE",
        arguments: { title: "Ship it", teamId: "t1" },
      },
    ])
  })

  it("returns a structured connector error (with reconnect hint) when execute fails", async () => {
    const executor: ComposioExecutor = {
      execute: async () => {
        throw new Error("Composio execute → status 401 unauthorized")
      },
    }
    const tools = toolsFor(executor, buildCtx())

    const result = (await tools["LINEAR_LIST_LINEAR_ISSUES"]!.execute({})) as {
      error: string
      hint?: string
    }
    expect(result.error).toContain("401")
    expect(result.hint).toContain("reconnect")
  })
})
