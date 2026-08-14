import { describe, expect, it, mock } from "bun:test"
import { z } from "zod"
import type { ConnectorContext } from "../connector-def.js"
import { composioCatalogToolToSpec, createComposioTools } from "./adapter.js"
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
  {
    slug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    description: "Create a media container",
    parameters: z.object({ ig_user_id: z.string().optional(), image_url: z.string().optional() }),
    resolvedParams: { ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } },
  },
  {
    slug: "WHATSAPP_SEND_MESSAGE",
    description: "Send a WhatsApp message",
    parameters: z.object({
      phone_number_id: z.string().optional(),
      to_number: z.string(),
      text: z.string(),
    }),
    resolvedParams: { phone_number_id: { viaSlug: "WHATSAPP_GET_PHONE_NUMBERS", list: true } },
  },
]

function fakeExecutor(
  result: unknown = { ok: true },
  opts?: { withStageFile?: boolean; resultFor?: Record<string, unknown> },
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
      return opts?.resultFor?.[input.slug] ?? result
    },
    ...(opts?.withStageFile
      ? {
          stageFile: async (input: { url: string; toolSlug: string; toolkitSlug: string }) => {
            stageCalls.push(input)
            return {
              name: "staged.bin",
              mimetype: "application/octet-stream",
              s3key: `key-${stageCalls.length}`,
            }
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
      "INSTAGRAM_CREATE_MEDIA_CONTAINER",
      "LINEAR_CREATE_LINEAR_ISSUE",
      "LINEAR_DELETE_LINEAR_ISSUE",
      "LINEAR_LIST_LINEAR_ISSUES",
      "WHATSAPP_SEND_MESSAGE",
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

  it("enriches a read tool's { error } result with the same reconnect hint a thrown auth error would get", async () => {
    // Composio's real 200-but-successful:false shape (reproduced live against the
    // Photos Library API) is a normal RETURN value, not a thrown exception — so it
    // never reached connectorError()'s hint logic for read actions. The model saw
    // raw, unhinted JSON and had no signal to tell the user "reconnect" instead of
    // guessing "not connected".
    const executor = fakeExecutor({
      error:
        'Composio execute GOOGLEPHOTOS_LIST_ALBUMS → status 200: {"error":{"code":401,"message":"Request had invalid authentication credentials. Expected OAuth 2 access token.","status":"UNAUTHENTICATED"}}',
    })
    const tools = toolsFor(executor, buildCtx())

    const result = (await tools["LINEAR_LIST_LINEAR_ISSUES"]!.execute({})) as {
      error: string
      hint?: string
    }

    expect(result.error).toContain("invalid authentication credentials")
    expect(result.hint).toContain("reconnect")
  })

  it("leaves a non-auth read error result alone — no spurious hint", async () => {
    const executor = fakeExecutor({ error: "Rate limit exceeded, try again later" })
    const tools = toolsFor(executor, buildCtx())

    const result = (await tools["LINEAR_LIST_LINEAR_ISSUES"]!.execute({})) as {
      error: string
      hint?: string
    }

    expect(result.error).toContain("Rate limit exceeded")
    expect(result.hint).toBeUndefined()
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

describe("composioCatalogToolToSpec", () => {
  it("converts the latest catalog metadata into a validated spec", () => {
    const spec = composioCatalogToolToSpec({
      slug: "GOOGLE_MAPS_AUTOCOMPLETE",
      description: "Autocomplete places",
      input_parameters: {
        input: { type: "string", required: true, description: "Text" },
        languageCode: { type: "string", required: false },
        photo: { type: "string", required: false, file_uploadable: true },
      },
    })

    expect(spec.fileParams).toEqual(["photo"])
    expect(spec.parameters.safeParse({ input: "coffee" }).success).toBe(true)
    expect(spec.parameters.safeParse({}).success).toBe(false)
    expect(spec.parameters.safeParse({ input: 42 }).success).toBe(false)
  })

  it("resolves Instagram catalog actions to the connected Business Account", () => {
    const spec = composioCatalogToolToSpec({
      slug: "INSTAGRAM_GET_IG_MEDIA",
      input_parameters: { ig_user_id: { type: "string", required: true } },
    })
    expect(spec.resolvedParams).toEqual({
      ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" },
    })
  })

  it("supports nested objects, arrays, and enum parameters", () => {
    const spec = composioCatalogToolToSpec({
      slug: "TEST_TOOL",
      input_parameters: {
        modes: { type: "array", items: { type: "string", enum: ["fast", "safe"] } },
        options: {
          type: "object",
          properties: { enabled: { type: "boolean", required: true } },
        },
      },
    })

    expect(spec.parameters.safeParse({ modes: ["fast"], options: { enabled: true } }).success).toBe(
      true,
    )
    expect(spec.parameters.safeParse({ modes: ["unknown"] }).success).toBe(false)
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
      {
        url: "https://assets.example.com/photo.jpg",
        toolSlug: "DROPBOX_UPLOAD_FILE",
        toolkitSlug: "linear",
      },
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

describe("createComposioTools — resolvedParams", () => {
  it("overrides a model-guessed account id with the real one resolved via another action (replay path)", async () => {
    const executor = fakeExecutor(
      { ok: true },
      { resultFor: { INSTAGRAM_GET_USER_INFO: { id: "17841400000000000" } } },
    )
    const tools = toolsFor(executor, buildCtx())

    const result = await tools["INSTAGRAM_CREATE_MEDIA_CONTAINER"]!.execute({
      ig_user_id: "media", // whatever the model guessed — must not reach the executor
      image_url: "https://assets.example.com/logo.jpg",
    })

    expect(result).toEqual({ ok: true })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "INSTAGRAM_GET_USER_INFO", arguments: {} },
      {
        userId: "user_1",
        slug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
        arguments: {
          ig_user_id: "17841400000000000",
          image_url: "https://assets.example.com/logo.jpg",
        },
      },
    ])
  })

  it("does not resolve while only queuing for approval — resolution waits for replay", async () => {
    const executor = fakeExecutor(
      { ok: true },
      { resultFor: { INSTAGRAM_GET_USER_INFO: { id: "17841400000000000" } } },
    )
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const tools = toolsFor(executor, buildCtx({ createPendingAction: create }))

    await tools["INSTAGRAM_CREATE_MEDIA_CONTAINER"]!.execute({
      ig_user_id: "media",
      image_url: "https://assets.example.com/logo.jpg",
    })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect((arg["payload"] as Record<string, unknown>)["ig_user_id"]).toBe("media")
  })

  it("auto-fills a list-resolved param when the account has exactly one item", async () => {
    const executor = fakeExecutor(
      { ok: true },
      {
        resultFor: {
          WHATSAPP_GET_PHONE_NUMBERS: [{ id: "1234567890", display_phone_number: "+1 555" }],
        },
      },
    )
    const tools = toolsFor(executor, buildCtx())

    await tools["WHATSAPP_SEND_MESSAGE"]!.execute({
      phone_number_id: "guessed-wrong",
      to_number: "+1 555 000 0000",
      text: "hi",
    })

    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "WHATSAPP_GET_PHONE_NUMBERS", arguments: {} },
      {
        userId: "user_1",
        slug: "WHATSAPP_SEND_MESSAGE",
        arguments: { phone_number_id: "1234567890", to_number: "+1 555 000 0000", text: "hi" },
      },
    ])
  })

  it("leaves a list-resolved param untouched when the account has more than one item — guessing wrong is worse than not guessing", async () => {
    const executor = fakeExecutor(
      { ok: true },
      {
        resultFor: {
          WHATSAPP_GET_PHONE_NUMBERS: [{ id: "1111111111" }, { id: "2222222222" }],
        },
      },
    )
    const tools = toolsFor(executor, buildCtx())

    await tools["WHATSAPP_SEND_MESSAGE"]!.execute({
      phone_number_id: "guessed-wrong",
      to_number: "+1 555 000 0000",
      text: "hi",
    })

    expect(executor.calls[1]).toEqual({
      userId: "user_1",
      slug: "WHATSAPP_SEND_MESSAGE",
      arguments: { phone_number_id: "guessed-wrong", to_number: "+1 555 000 0000", text: "hi" },
    })
  })

  it("leaves a list-resolved param untouched when the account has zero items", async () => {
    const executor = fakeExecutor({ ok: true }, { resultFor: { WHATSAPP_GET_PHONE_NUMBERS: [] } })
    const tools = toolsFor(executor, buildCtx())

    await tools["WHATSAPP_SEND_MESSAGE"]!.execute({
      phone_number_id: "guessed-wrong",
      to_number: "+1 555 000 0000",
      text: "hi",
    })

    expect(executor.calls[1]).toEqual({
      userId: "user_1",
      slug: "WHATSAPP_SEND_MESSAGE",
      arguments: { phone_number_id: "guessed-wrong", to_number: "+1 555 000 0000", text: "hi" },
    })
  })

  it("also unwraps Facebook's nested Graph API pagination envelope ({ response_data: { data: [...] } })", async () => {
    const executor = fakeExecutor(
      { ok: true },
      {
        resultFor: {
          FACEBOOK_GET_USER_PAGES: {
            response_data: { data: [{ id: "998877", name: "My Page" }], paging: {} },
          },
        },
      },
    )
    const specsWithFacebook: ComposioToolSpec[] = [
      {
        slug: "FACEBOOK_CREATE_POST",
        description: "Create a post",
        parameters: z.object({ page_id: z.string().optional(), message: z.string() }),
        resolvedParams: { page_id: { viaSlug: "FACEBOOK_GET_USER_PAGES", list: true } },
      },
    ]
    const tools = createComposioTools({
      provider: "facebook",
      toolkit: "facebook",
      specs: specsWithFacebook,
      executor,
    })(buildCtx()) as Record<string, { execute: (args: unknown) => Promise<unknown> }>

    await tools["FACEBOOK_CREATE_POST"]!.execute({ page_id: "guessed-wrong", message: "hello" })

    expect(executor.calls[1]).toEqual({
      userId: "user_1",
      slug: "FACEBOOK_CREATE_POST",
      arguments: { page_id: "998877", message: "hello" },
    })
  })
})
