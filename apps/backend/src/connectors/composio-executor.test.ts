import { describe, expect, it } from "bun:test"
import type { ComposioExecutor } from "@yomi/agent-core"
import { createComposioRestExecutor, createCountingExecutor } from "./composio-executor.js"

function capturingFetch(response: Response) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return response
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe("createComposioRestExecutor", () => {
  it("posts to the execute endpoint with the api key and snake_case body", async () => {
    const { fn, calls } = capturingFetch(
      Response.json({ data: { issues: [] }, successful: true }),
    )
    const exec = createComposioRestExecutor({ apiKey: "k1", baseUrl: "https://x.test", fetchImpl: fn })

    const result = await exec.execute({
      userId: "user_1",
      slug: "LINEAR_LIST_LINEAR_ISSUES",
      arguments: { first: 5 },
    })

    expect(result).toEqual({ issues: [] })
    expect(calls[0]!.url).toBe("https://x.test/api/v3/tools/execute/LINEAR_LIST_LINEAR_ISSUES")
    const init = calls[0]!.init!
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k1")
    expect(JSON.parse(init.body as string)).toEqual({
      user_id: "user_1",
      arguments: { first: 5 },
    })
  })

  it("surfaces a Composio 200-but-failed response as an error result", async () => {
    const { fn } = capturingFetch(Response.json({ successful: false, error: "no connected account" }))
    const exec = createComposioRestExecutor({ apiKey: "k1", fetchImpl: fn })
    const result = (await exec.execute({ userId: "u", slug: "S", arguments: {} })) as {
      error: string
    }
    expect(result.error).toContain("no connected account")
  })

  it("throws with status on a non-2xx response", async () => {
    const { fn } = capturingFetch(new Response("nope", { status: 401 }))
    const exec = createComposioRestExecutor({ apiKey: "k1", fetchImpl: fn })
    await expect(exec.execute({ userId: "u", slug: "S", arguments: {} })).rejects.toThrow(/401/)
  })

  it("throws when no api key is configured", async () => {
    const exec = createComposioRestExecutor({ apiKey: "" })
    await expect(exec.execute({ userId: "u", slug: "S", arguments: {} })).rejects.toThrow(
      /COMPOSIO_API_KEY/,
    )
  })
})

describe("createCountingExecutor", () => {
  function inner(result: unknown = { ok: true }): ComposioExecutor & { seen: number } {
    const box = { seen: 0 } as ComposioExecutor & { seen: number }
    box.execute = async () => {
      box.seen++
      return result
    }
    return box
  }

  it("tallies each execute call and passes through the result", async () => {
    const executor = createCountingExecutor(inner({ data: 1 }))
    expect(executor.count()).toBe(0)
    expect(await executor.execute({ userId: "u", slug: "A", arguments: {} })).toEqual({ data: 1 })
    await executor.execute({ userId: "u", slug: "B", arguments: {} })
    expect(executor.count()).toBe(2)
  })

  it("counts a call even when the inner executor throws (the call still hit Composio)", async () => {
    const failing: ComposioExecutor = {
      execute: async () => {
        throw new Error("boom")
      },
    }
    const executor = createCountingExecutor(failing)
    await expect(executor.execute({ userId: "u", slug: "A", arguments: {} })).rejects.toThrow("boom")
    expect(executor.count()).toBe(1)
  })
})
