import { afterEach, describe, expect, it } from "bun:test"
import type { LanguageModelV1CallOptions } from "@ai-sdk/provider"
import { createModel } from "./model.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

// Captures the JSON body sent to /chat/completions and returns a stub reply.
function captureRequestBody(): { body: Record<string, unknown> | null } {
  const captured: { body: Record<string, unknown> | null } = { body: null }
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }) as typeof fetch
  return captured
}

function callOptions(overrides: Partial<LanguageModelV1CallOptions> = {}): LanguageModelV1CallOptions {
  return {
    inputFormat: "messages",
    mode: { type: "regular" },
    prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    temperature: 0,
    topP: 0.9,
    ...overrides,
  } as LanguageModelV1CallOptions
}

describe("requestBody sampling params", () => {
  it("omits temperature and top_p for gpt-5.x reasoning models", async () => {
    const captured = captureRequestBody()
    await createModel("gpt-5.5").doGenerate(callOptions())
    expect(captured.body).not.toBeNull()
    expect(captured.body).not.toContainKey("temperature")
    expect(captured.body).not.toContainKey("top_p")
  })

  it("omits sampling params for gpt-5.4-mini too", async () => {
    const captured = captureRequestBody()
    await createModel("gpt-5.4-mini").doGenerate(callOptions())
    expect(captured.body).not.toContainKey("temperature")
    expect(captured.body).not.toContainKey("top_p")
  })

  it("still passes temperature and top_p for non-reasoning models", async () => {
    const captured = captureRequestBody()
    await createModel("gpt-4o-mini").doGenerate(callOptions())
    expect(captured.body?.["temperature"]).toBe(0)
    expect(captured.body?.["top_p"]).toBe(0.9)
  })
})
