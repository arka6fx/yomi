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
  {
    slug: "DROPBOX_UPLOAD_FILE",
    description: "Upload a file",
    parameters: z.object({ path: z.string(), content: z.string() }),
    fileParams: ["content"],
  },
]

function fakeExecutor(
  result: unknown = { ok: true },
  opts?: { withStageFile?: boolean },
): ComposioExecutor & {
  calls: { userId: string; slug: string; arguments: unknown }[]
  stageCalls: { url: string; toolSlug: string; toolkitSlug: string }[]
} {
  const calls: { userId: string; slug: string; arguments: unknown }[] = []
  const stageCalls: { url: string; toolSlug: string; toolkitSlug: string }[] = []
  return {
    calls,
    stageCalls,
    execute: async (input) => {
      calls.push(input)
      return result
    },
    ...(opts?.withStageFile
      ? {
          stageFile: async (input: { url: string; toolSlug: string; toolkitSlug: string }) => {
            stageCalls.push(input)
            return { name: "staged.bin", mimetype: "application/octet-stream", s3key: `key-${stageCalls.length}` }
          },
        }
      : {}),
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
      "DROPBOX_UPLOAD_FILE",
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

  it("caps an oversized read result so it can't blow the model's context/TPM limit", async () => {
    // Composio actions (e.g. GMAIL_FETCH_MESSAGE_BY_THREAD_ID) return whatever the
    // provider gives back, with no size contract — a real prod incident saw a single
    // Gmail fetch return ~1M tokens of raw JSON and blow the TPM limit. The adapter
    // must cap total result size regardless of what the executor hands back.
    const hugeBody = "x".repeat(50_000)
    const executor = fakeExecutor({ messages: [{ id: "1", body: hugeBody }] })
    const tools = toolsFor(executor, buildCtx())

    const result = await tools["LINEAR_LIST_LINEAR_ISSUES"]!.execute({})

    expect(JSON.stringify(result).length).toBeLessThan(hugeBody.length)
  })

  it("caps a read result with many items, not just long strings", async () => {
    const manyItems = Array.from({ length: 500 }, (_, i) => ({ id: i, snippet: "y".repeat(200) }))
    const executor = fakeExecutor({ items: manyItems })
    const tools = toolsFor(executor, buildCtx())

    const result = await tools["LINEAR_LIST_LINEAR_ISSUES"]!.execute({})

    expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify({ items: manyItems }).length)
  })

  it("leaves small results byte-for-byte unchanged", async () => {
    const executor = fakeExecutor({ issues: [{ id: "1" }] })
    const tools = toolsFor(executor, buildCtx())

    const result = await tools["LINEAR_LIST_LINEAR_ISSUES"]!.execute({})

    expect(result).toEqual({ issues: [{ id: "1" }] })
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

describe("createComposioTools — fileParams staging", () => {
  it("stages a fileParams URL and executes with the descriptor, not the raw URL (replay path)", async () => {
    const executor = fakeExecutor({ ok: true }, { withStageFile: true })
    // No createPendingAction — mirrors the backend replay executor, same as the
    // existing "on approval replay" test above.
    const tools = toolsFor(executor, buildCtx())

    const result = await tools["DROPBOX_UPLOAD_FILE"]!.execute({
      path: "/Images/photo.jpg",
      content: "https://assets.example.com/photo.jpg",
    })

    expect(result).toEqual({ ok: true })
    expect(executor.stageCalls).toEqual([
      { url: "https://assets.example.com/photo.jpg", toolSlug: "DROPBOX_UPLOAD_FILE", toolkitSlug: "linear" },
    ])
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "DROPBOX_UPLOAD_FILE",
        arguments: {
          path: "/Images/photo.jpg",
          content: { name: "staged.bin", mimetype: "application/octet-stream", s3key: "key-1" },
        },
      },
    ])
  })

  it("does not stage the file when the action is only queued for approval — staging waits for replay", async () => {
    const executor = fakeExecutor({ ok: true }, { withStageFile: true })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const tools = toolsFor(executor, buildCtx({ createPendingAction: create }))

    await tools["DROPBOX_UPLOAD_FILE"]!.execute({
      path: "/Images/photo.jpg",
      content: "https://assets.example.com/photo.jpg",
    })

    // Queued with the raw URL still in the payload — nothing staged yet, and no
    // provider call happened (same invariant as the plain write-tool test above).
    expect(executor.stageCalls).toEqual([])
    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect((arg["payload"] as Record<string, unknown>)["content"]).toBe(
      "https://assets.example.com/photo.jpg",
    )
  })

  it("leaves a missing or non-string fileParams value alone instead of staging it", async () => {
    const executor = fakeExecutor({ ok: true }, { withStageFile: true })
    const tools = toolsFor(executor, buildCtx())

    await tools["DROPBOX_UPLOAD_FILE"]!.execute({ path: "/x.jpg" })

    expect(executor.stageCalls).toEqual([])
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "DROPBOX_UPLOAD_FILE", arguments: { path: "/x.jpg" } },
    ])
  })

  it("fails clearly instead of silently sending a raw URL when the executor has no stageFile", async () => {
    const executor = fakeExecutor({ ok: true }) // no stageFile — e.g. a test/native executor
    const tools = toolsFor(executor, buildCtx())

    const result = (await tools["DROPBOX_UPLOAD_FILE"]!.execute({
      path: "/x.jpg",
      content: "https://assets.example.com/photo.jpg",
    })) as { error: string }

    expect(result.error).toContain("stageFile")
    expect(executor.calls).toEqual([])
  })
})
