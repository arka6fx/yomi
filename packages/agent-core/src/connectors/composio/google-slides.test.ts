import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioSlidesDef, slidesComposioSpecs, SLIDES_TOOLKIT } from "./google-slides.js"
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

describe("Slides via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioSlidesDef(fakeExecutor())
    expect(def.id).toBe("google-slides")
    expect(def.name).toBe("Google Slides")
    expect(def.category).toBe("productivity")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: SLIDES_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SLIDES_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioSlidesDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLESLIDES_CREATE_SLIDES_MARKDOWN"]).toBeDefined()
    expect(tools["GOOGLESLIDES_PRESENTATIONS_GET"]).toBeDefined()
  })
})

describe("Slides via Composio — read pass-through", () => {
  it("executes a Slides read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ presentationId: "p1", slides: [] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-slides",
      toolkit: SLIDES_TOOLKIT,
      specs: slidesComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLESLIDES_PRESENTATIONS_GET"]!.execute({ presentationId: "p1" })

    expect(result).toEqual({ presentationId: "p1", slides: [] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLESLIDES_PRESENTATIONS_GET", arguments: { presentationId: "p1" } },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Slides via Composio — write gating", () => {
  it("routes markdown deck creation through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-slides",
      toolkit: SLIDES_TOOLKIT,
      specs: slidesComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLESLIDES_CREATE_SLIDES_MARKDOWN"]!.execute({
      title: "New Deck",
      markdown_text: "# Slide 1\n---\n# Slide 2",
    })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })
})

describe("Slides via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ presentationId: "newdeck1" })
    const factory = createComposioTools({
      provider: "google-slides",
      toolkit: SLIDES_TOOLKIT,
      specs: slidesComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["GOOGLESLIDES_CREATE_SLIDES_MARKDOWN"]!.execute({
      title: "Report Deck",
      markdown_text: "# Title",
    })

    expect(result).toEqual({ presentationId: "newdeck1" })
  })
})
