import { afterEach, describe, expect, it } from "bun:test"
import { tool } from "ai"
import { z } from "zod"
import { runAgentLoop } from "./agent.js"
import type { ConnectorRegistry } from "./connectors/registry.js"

const originalFetch = globalThis.fetch

// A registry with no connectors — the loop uses extraTools instead.
const emptyRegistry = { getAllDefTools: () => ({}) } as unknown as ConnectorRegistry

const echoTool = tool({
  description: "echo",
  parameters: z.object({}),
  execute: async () => ({ ok: true, message: "did the thing" }),
})

function chatResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("runAgentLoop grace call", () => {
  it("summarises via a toolChoice:none call when the loop ends with empty text", async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push(body)
      const call = bodies.length
      if (call === 1) {
        // Step 1: the model calls the tool.
        return chatResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: "call_1", type: "function", function: { name: "echo", arguments: "{}" } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        })
      }
      if (call === 2) {
        // Step 2: model stops without producing any text.
        return chatResponse({
          choices: [{ message: { content: "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 0 },
        })
      }
      // Grace call: forced to answer with no tools.
      return chatResponse({
        choices: [{ message: { content: "All set — I did the thing." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      })
    }) as typeof fetch

    const usages: string[] = []
    const text = await runAgentLoop({
      registry: emptyRegistry,
      text: "do the thing",
      extraTools: { echo: echoTool },
      onUsage: (u) => usages.push(u.finishReason),
    })

    expect(text).toBe("All set — I did the thing.")
    // Three model calls: two loop steps + one grace call.
    expect(bodies).toHaveLength(3)
    // The grace call declares tools but forbids calling them.
    expect(bodies[2]?.["tool_choice"]).toBe("none")
    expect(bodies[2]?.["tools"]).toBeDefined()
    // Usage telemetry tags the grace call distinctly.
    expect(usages.some((r) => r.startsWith("grace:"))).toBe(true)
  })

  it("returns the model text directly without a grace call when the loop answers", async () => {
    const bodies: unknown[] = []
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return chatResponse({
        choices: [{ message: { content: "Here is your answer." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      })
    }) as typeof fetch

    const text = await runAgentLoop({ registry: emptyRegistry, text: "hi" })
    expect(text).toBe("Here is your answer.")
    expect(bodies).toHaveLength(1) // no grace call
  })
})
