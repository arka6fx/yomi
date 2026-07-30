import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import {
  instagramComposioSpecs,
  makeComposioInstagramDef,
  publishInstagramMedia,
} from "./instagram.js"
import type { ComposioExecutor } from "./adapter.js"

describe("instagramComposioSpecs", () => {
  it.each([
    "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
    "INSTAGRAM_CREATE_POST",
  ])(
    "auto-resolves ig_user_id via INSTAGRAM_GET_USER_INFO for %s instead of trusting the model's guess",
    (slug) => {
      const spec = instagramComposioSpecs.find((s) => s.slug === slug)
      expect(spec?.resolvedParams).toEqual({ ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } })
    },
  )
})

// A real Instagram post that "succeeded" (container created) but then never got
// published — an earlier bug: a second, independent LLM turn concluded the media
// fetch had failed (it hadn't; the container had already finished processing) and
// told the user to re-upload. Root cause: the model had to reliably chain create ->
// poll status -> publish across two separate approvals, and a later, unrelated turn
// could contradict a step that had already succeeded. Collapsing the three Composio
// calls into one deterministic, server-side sequence removes that failure mode.
function fakeExecutor(
  resultFor: Record<string, unknown[] | unknown>,
): ComposioExecutor & { calls: { userId: string; slug: string; arguments: unknown }[] } {
  const calls: { userId: string; slug: string; arguments: unknown }[] = []
  const queues = new Map<string, unknown[]>()
  for (const [slug, result] of Object.entries(resultFor)) {
    queues.set(slug, Array.isArray(result) ? [...result] : [result])
  }
  return {
    calls,
    execute: async (input) => {
      calls.push(input)
      const queue = queues.get(input.slug)
      if (!queue || queue.length === 0) throw new Error(`no fake result queued for ${input.slug}`)
      return queue.length > 1 ? queue.shift() : queue[0]
    },
  }
}

describe("publishInstagramMedia", () => {
  const FAST = { pollIntervalMs: 0, timeoutMs: 1000 }

  it("resolves ig_user_id, creates the container, polls until FINISHED, then publishes", async () => {
    const executor = fakeExecutor({
      INSTAGRAM_GET_USER_INFO: { id: "17841400000000000" },
      INSTAGRAM_CREATE_MEDIA_CONTAINER: { id: "container-1" },
      INSTAGRAM_GET_POST_STATUS: [
        { id: "container-1", status_code: "IN_PROGRESS" },
        { id: "container-1", status_code: "FINISHED" },
      ],
      INSTAGRAM_CREATE_POST: { id: "published-1" },
    })

    const result = await publishInstagramMedia(
      executor,
      "user_1",
      { image_url: "https://assets.example.com/logo.jpg", caption: "New logo" },
      FAST,
    )

    expect(result).toEqual({ id: "published-1" })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "INSTAGRAM_GET_USER_INFO", arguments: {} },
      {
        userId: "user_1",
        slug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
        arguments: {
          ig_user_id: "17841400000000000",
          image_url: "https://assets.example.com/logo.jpg",
          video_url: undefined,
          caption: "New logo",
        },
      },
      {
        userId: "user_1",
        slug: "INSTAGRAM_GET_POST_STATUS",
        arguments: { creation_id: "container-1" },
      },
      {
        userId: "user_1",
        slug: "INSTAGRAM_GET_POST_STATUS",
        arguments: { creation_id: "container-1" },
      },
      {
        userId: "user_1",
        slug: "INSTAGRAM_CREATE_POST",
        arguments: { ig_user_id: "17841400000000000", creation_id: "container-1" },
      },
    ])
  })

  it("stops and returns the error when the account can't be resolved, without touching the media APIs", async () => {
    const executor = fakeExecutor({ INSTAGRAM_GET_USER_INFO: {} })

    const result = await publishInstagramMedia(
      executor,
      "user_1",
      { image_url: "https://x/y.jpg" },
      FAST,
    )

    expect(result).toEqual({ error: "Could not resolve the connected Instagram account." })
    expect(executor.calls).toHaveLength(1)
  })

  it("returns the container-creation error immediately, without polling or publishing", async () => {
    const executor = fakeExecutor({
      INSTAGRAM_GET_USER_INFO: { id: "17841400000000000" },
      INSTAGRAM_CREATE_MEDIA_CONTAINER: { error: "Failed to create container (status 400)." },
    })

    const result = await publishInstagramMedia(
      executor,
      "user_1",
      { image_url: "https://x/y.jpg" },
      FAST,
    )

    expect(result).toEqual({ error: "Failed to create container (status 400)." })
    expect(executor.calls.map((c) => c.slug)).toEqual([
      "INSTAGRAM_GET_USER_INFO",
      "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    ])
  })

  it("does not publish when Instagram reports the container as ERROR", async () => {
    const executor = fakeExecutor({
      INSTAGRAM_GET_USER_INFO: { id: "17841400000000000" },
      INSTAGRAM_CREATE_MEDIA_CONTAINER: { id: "container-1" },
      INSTAGRAM_GET_POST_STATUS: { id: "container-1", status_code: "ERROR" },
    })

    const result = await publishInstagramMedia(
      executor,
      "user_1",
      { image_url: "https://x/y.jpg" },
      FAST,
    )

    expect(result).toEqual({ error: "Instagram couldn't process the media (status: ERROR)." })
    expect(executor.calls.map((c) => c.slug)).toEqual([
      "INSTAGRAM_GET_USER_INFO",
      "INSTAGRAM_CREATE_MEDIA_CONTAINER",
      "INSTAGRAM_GET_POST_STATUS",
    ])
  })

  it("gives up and reports a clear error instead of a false failure when it never leaves IN_PROGRESS before the deadline", async () => {
    const executor = fakeExecutor({
      INSTAGRAM_GET_USER_INFO: { id: "17841400000000000" },
      INSTAGRAM_CREATE_MEDIA_CONTAINER: { id: "container-1" },
      INSTAGRAM_GET_POST_STATUS: { id: "container-1", status_code: "IN_PROGRESS" },
    })

    const result = await publishInstagramMedia(
      executor,
      "user_1",
      { image_url: "https://x/y.jpg" },
      {
        pollIntervalMs: 0,
        timeoutMs: 5,
      },
    )

    expect(result).toEqual({ error: "Instagram couldn't process the media (status: IN_PROGRESS)." })
  })
})

describe("makeComposioInstagramDef — INSTAGRAM_PUBLISH_MEDIA tool", () => {
  function buildCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
    return { userId: "user_1", getAccessToken: async () => "unused", ...overrides }
  }

  it("gates the composed publish action behind approval, same as any other write", async () => {
    const executor = fakeExecutor({})
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const def = makeComposioInstagramDef(executor)
    const tools = def.tools(buildCtx({ createPendingAction: create })) as Record<
      string,
      { execute: (args: unknown) => Promise<unknown> }
    >

    expect(tools["INSTAGRAM_PUBLISH_MEDIA"]).toBeDefined()
    await tools["INSTAGRAM_PUBLISH_MEDIA"]!.execute({ image_url: "https://x/y.jpg", caption: "hi" })

    expect(create).toHaveBeenCalledTimes(1)
    expect(executor.calls).toEqual([])
  })

  it("on replay, runs the full create → poll → publish sequence and returns the published result", async () => {
    const executor = fakeExecutor({
      INSTAGRAM_GET_USER_INFO: { id: "17841400000000000" },
      INSTAGRAM_CREATE_MEDIA_CONTAINER: { id: "container-1" },
      INSTAGRAM_GET_POST_STATUS: { id: "container-1", status_code: "FINISHED" },
      INSTAGRAM_CREATE_POST: { id: "published-1" },
    })
    const def = makeComposioInstagramDef(executor)
    const tools = def.tools(buildCtx()) as Record<
      string,
      { execute: (args: unknown) => Promise<unknown> }
    >

    const result = await tools["INSTAGRAM_PUBLISH_MEDIA"]!.execute({
      image_url: "https://x/y.jpg",
      caption: "hi",
    })

    expect(result).toEqual({ id: "published-1" })
  })
})
