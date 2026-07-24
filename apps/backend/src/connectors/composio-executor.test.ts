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

function routedFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init })
    const route = routes[u]
    if (!route) throw new Error(`unexpected fetch: ${u}`)
    return route()
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe("createComposioRestExecutor.stageFile", () => {
  const sourceUrl = "https://assets.example.com/photo.jpg"
  const stageUrl = "https://x.test/api/v3.1/files/upload/request"
  const uploadUrl = "https://storage.composio.dev/upload-here"

  function sourceResponse() {
    return new Response(new Uint8Array([1, 2, 3]).buffer, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    })
  }

  function stageResponse(storageBackend: "s3" | "azure_blob_storage" = "s3") {
    return Response.json({
      id: "req_1",
      key: "projects/pr_1/requests/dropbox/photo.jpg",
      new_presigned_url: uploadUrl,
      metadata: { storage_backend: storageBackend },
    })
  }

  it("fetches the source, requests a presigned upload, PUTs the bytes, and returns the descriptor", async () => {
    const { fn, calls } = routedFetch({
      [sourceUrl]: sourceResponse,
      [stageUrl]: () => stageResponse("s3"),
      [uploadUrl]: () => new Response(null, { status: 200 }),
    })
    const exec = createComposioRestExecutor({ apiKey: "k1", baseUrl: "https://x.test", fetchImpl: fn })

    const result = await exec.stageFile!({
      url: sourceUrl,
      toolSlug: "DROPBOX_UPLOAD_FILE",
      toolkitSlug: "dropbox",
    })

    expect(result).toEqual({
      name: "photo.jpg",
      mimetype: "image/jpeg",
      s3key: "projects/pr_1/requests/dropbox/photo.jpg",
    })

    const stageCall = calls.find((c) => c.url === stageUrl)!
    const body = JSON.parse(stageCall.init!.body as string)
    expect(body).toMatchObject({
      filename: "photo.jpg",
      mimetype: "image/jpeg",
      tool_slug: "DROPBOX_UPLOAD_FILE",
      toolkit_slug: "dropbox",
    })
    expect(body.md5).toMatch(/^[0-9a-f]{32}$/) // real md5 of the 3 source bytes, not a placeholder
    expect((stageCall.init!.headers as Record<string, string>)["x-api-key"]).toBe("k1")

    const putCall = calls.find((c) => c.url === uploadUrl)!
    expect(putCall.init!.method).toBe("PUT")
    expect((putCall.init!.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg")
    expect(putCall.init!.headers).not.toHaveProperty("x-ms-blob-type")
  })

  it("sets the Azure blob-type header when the storage backend is azure_blob_storage", async () => {
    const { fn, calls } = routedFetch({
      [sourceUrl]: sourceResponse,
      [stageUrl]: () => stageResponse("azure_blob_storage"),
      [uploadUrl]: () => new Response(null, { status: 200 }),
    })
    const exec = createComposioRestExecutor({ apiKey: "k1", baseUrl: "https://x.test", fetchImpl: fn })

    await exec.stageFile!({ url: sourceUrl, toolSlug: "S", toolkitSlug: "t" })

    const putCall = calls.find((c) => c.url === uploadUrl)!
    expect((putCall.init!.headers as Record<string, string>)["x-ms-blob-type"]).toBe("BlockBlob")
  })

  it("throws when the source file can't be fetched", async () => {
    const { fn } = routedFetch({ [sourceUrl]: () => new Response("nope", { status: 404 }) })
    const exec = createComposioRestExecutor({ apiKey: "k1", baseUrl: "https://x.test", fetchImpl: fn })

    await expect(
      exec.stageFile!({ url: sourceUrl, toolSlug: "S", toolkitSlug: "t" }),
    ).rejects.toThrow(/404/)
  })

  it("throws when the presigned-upload request fails", async () => {
    const { fn } = routedFetch({
      [sourceUrl]: sourceResponse,
      [stageUrl]: () => new Response("denied", { status: 403 }),
    })
    const exec = createComposioRestExecutor({ apiKey: "k1", baseUrl: "https://x.test", fetchImpl: fn })

    await expect(
      exec.stageFile!({ url: sourceUrl, toolSlug: "S", toolkitSlug: "t" }),
    ).rejects.toThrow(/403/)
  })

  it("throws when the final upload to storage fails", async () => {
    const { fn } = routedFetch({
      [sourceUrl]: sourceResponse,
      [stageUrl]: () => stageResponse("s3"),
      [uploadUrl]: () => new Response("nope", { status: 500 }),
    })
    const exec = createComposioRestExecutor({ apiKey: "k1", baseUrl: "https://x.test", fetchImpl: fn })

    await expect(
      exec.stageFile!({ url: sourceUrl, toolSlug: "S", toolkitSlug: "t" }),
    ).rejects.toThrow(/500/)
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

  it("forwards stageFile without counting it (staging isn't a tools/execute call)", async () => {
    const staged = { name: "f", mimetype: "image/jpeg", s3key: "k1" }
    const withStaging: ComposioExecutor = {
      execute: async () => ({ ok: true }),
      stageFile: async () => staged,
    }
    const executor = createCountingExecutor(withStaging)

    const result = await executor.stageFile!({ url: "https://x", toolSlug: "S", toolkitSlug: "t" })

    expect(result).toEqual(staged)
    expect(executor.count()).toBe(0)
  })

  it("has no stageFile when the inner executor doesn't provide one", () => {
    const executor = createCountingExecutor(inner())
    expect(executor.stageFile).toBeUndefined()
  })
})
