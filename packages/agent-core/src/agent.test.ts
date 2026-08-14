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

// A cheap/bookkeeping tool (name is in guards.CHEAP_TOOLS) taking varying args,
// used to exercise the stall guard and the step-budget refund.
const rememberTool = tool({
  description: "remember",
  parameters: z.object({ n: z.number() }),
  execute: async () => ({ ok: true, message: "noted" }),
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

  it("accumulates cachedInputTokens from prompt_tokens_details across the run", async () => {
    globalThis.fetch = (async () =>
      chatResponse({
        choices: [{ message: { content: "answer" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 2000,
          completion_tokens: 10,
          prompt_tokens_details: { cached_tokens: 1800 },
        },
      })) as typeof fetch

    let usage: { cachedInputTokens: number; inputTokens: number } | undefined
    await runAgentLoop({
      registry: emptyRegistry,
      text: "hi",
      onUsage: (u) => {
        usage = u
      },
    })

    expect(usage?.inputTokens).toBe(2000)
    expect(usage?.cachedInputTokens).toBe(1800)
  })
})

// A model that always asks for another echo tool call, so the loop only ever
// stops because a budget is exhausted (never because the model is done).
function alwaysCallsTool(bodies: Record<string, unknown>[], completionTokens: number) {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    if (body["tool_choice"] === "none") {
      // Grace / summary call: forced to answer with no tools.
      return chatResponse({
        choices: [{ message: { content: "Here's what I got so far." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 4 },
      })
    }
    return chatResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: `call_${bodies.length}`,
                type: "function",
                function: { name: "echo", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: completionTokens },
    })
  }) as typeof fetch
}

describe("runAgentLoop iteration budget", () => {
  it("terminates at the step budget and returns a graceful summary", async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = alwaysCallsTool(bodies, 5)

    const reasons: string[] = []
    const text = await runAgentLoop({
      registry: emptyRegistry,
      text: "keep going",
      extraTools: { echo: echoTool },
      maxSteps: 2,
      onUsage: (u) => reasons.push(u.finishReason),
    })

    expect(text).toBe("Here's what I got so far.")
    // Two tool-calling steps + one grace/summary call.
    expect(bodies).toHaveLength(3)
    expect(bodies[2]?.["tool_choice"]).toBe("none")
    expect(reasons).toContain("budget:steps")
  })

  it("terminates at the output-token budget and returns a graceful summary", async () => {
    const bodies: Record<string, unknown>[] = []
    // Each step reports 100 output tokens; budget of 150 is exhausted after 2 steps.
    globalThis.fetch = alwaysCallsTool(bodies, 100)

    const reasons: string[] = []
    const text = await runAgentLoop({
      registry: emptyRegistry,
      text: "keep going",
      extraTools: { echo: echoTool },
      maxSteps: 50,
      maxOutputTokens: 150,
      onUsage: (u) => reasons.push(u.finishReason),
    })

    expect(text).toBe("Here's what I got so far.")
    expect(bodies).toHaveLength(3)
    expect(bodies[2]?.["tool_choice"]).toBe("none")
    expect(reasons).toContain("budget:tokens")
    expect(reasons).not.toContain("budget:steps")
  })

  it("reports run-cumulative usage in a single onUsage call", async () => {
    const bodies: Record<string, unknown>[] = []
    // Two tool steps (100 output tokens each) + grace call (4) before the budget stops.
    globalThis.fetch = alwaysCallsTool(bodies, 100)

    const usages: {
      inputTokens: number
      outputTokens: number
      toolCallCount: number
      finishReason: string
    }[] = []
    await runAgentLoop({
      registry: emptyRegistry,
      text: "keep going",
      extraTools: { echo: echoTool },
      maxSteps: 2,
      onUsage: (u) => usages.push(u),
    })

    // Backend persists onUsage into one row (last write wins), so the loop must
    // emit once with cumulative totals — not once per step.
    expect(usages).toHaveLength(1)
    expect(usages[0]?.finishReason).toBe("budget:steps")
    // 2 steps × 100 + grace 4 = 204 output tokens; 2 tool calls total.
    expect(usages[0]?.outputTokens).toBe(204)
    expect(usages[0]?.toolCallCount).toBe(2)
  })
})

// A model that keeps calling the given tool. When `varyArgs` is false the args
// are identical every step (trips the duplicate guard); when true they carry the
// call index (only the stall / budget guards can stop it).
function alwaysCallsNamedTool(
  bodies: Record<string, unknown>[],
  toolName: string,
  varyArgs: boolean,
  completionTokens = 5,
) {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    if (body["tool_choice"] === "none") {
      return chatResponse({
        choices: [{ message: { content: "Here's what I got so far." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 4 },
      })
    }
    const args = varyArgs ? JSON.stringify({ n: bodies.length }) : "{}"
    return chatResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: `call_${bodies.length}`,
                type: "function",
                function: { name: toolName, arguments: args },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: completionTokens },
    })
  }) as typeof fetch
}

describe("runAgentLoop loop guards", () => {
  it("stops the loop when the model repeats an identical tool call", async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = alwaysCallsNamedTool(bodies, "echo", false)

    const reasons: string[] = []
    const text = await runAgentLoop({
      registry: emptyRegistry,
      text: "loop forever",
      extraTools: { echo: echoTool },
      onUsage: (u) => reasons.push(u.finishReason),
    })

    expect(text).toBe("Here's what I got so far.")
    // Three identical tool steps (break on the 3rd) + one grace/summary call.
    expect(bodies).toHaveLength(4)
    expect(bodies[3]?.["tool_choice"]).toBe("none")
    expect(reasons).toContain("guard:duplicate")
  })

  it("stops the loop when the agent only ever does cheap bookkeeping (stall)", async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = alwaysCallsNamedTool(bodies, "remember", true)

    const reasons: string[] = []
    const text = await runAgentLoop({
      registry: emptyRegistry,
      text: "keep taking notes",
      extraTools: { remember: rememberTool },
      onUsage: (u) => reasons.push(u.finishReason),
    })

    expect(text).toBe("Here's what I got so far.")
    // Two empty windows of 5 cheap steps (10 steps) + one grace/summary call.
    expect(bodies).toHaveLength(11)
    expect(bodies[10]?.["tool_choice"]).toBe("none")
    expect(reasons).toContain("guard:stall")
  })

  it("refunds cheap steps so a low step budget does not cut a bookkeeping run short", async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push(body)
      const call = bodies.length
      if (call <= 2) {
        // Two cheap bookkeeping steps with distinct args.
        return chatResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: `call_${call}`,
                    type: "function",
                    function: { name: "remember", arguments: JSON.stringify({ n: call }) },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        })
      }
      // Then the model answers directly.
      return chatResponse({
        choices: [{ message: { content: "All done." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      })
    }) as typeof fetch

    const reasons: string[] = []
    const text = await runAgentLoop({
      registry: emptyRegistry,
      text: "take a couple of notes then answer",
      extraTools: { remember: rememberTool },
      maxSteps: 1, // would cut a non-cheap run off after one step
      onUsage: (u) => reasons.push(u.finishReason),
    })

    // The two cheap steps are refunded, so the budget never trips and the real
    // answer comes through instead of a grace summary.
    expect(text).toBe("All done.")
    expect(bodies).toHaveLength(3) // no grace call
    expect(reasons).not.toContain("budget:steps")
  })
})

// A user with enough connectors connected can push the merged tool set past
// OpenAI's 128-tool cap, which fails the whole turn with invalid_request_error
// regardless of what was asked. capToolSet() is the stopgap.
describe("runAgentLoop tool cap", () => {
  function manyTools(n: number, namedTool?: string): Record<string, typeof echoTool> {
    const tools: Record<string, typeof echoTool> = {}
    for (let i = 0; i < n; i++) tools[`tool_${i}`] = echoTool
    if (namedTool) tools[namedTool] = echoTool
    return tools
  }

  function okResponse() {
    return chatResponse({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    })
  }

  it("trims the tools sent to the model to at most 128", async () => {
    const bigRegistry = { getAllDefTools: () => manyTools(150) } as unknown as ConnectorRegistry
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return okResponse()
    }) as typeof fetch

    await runAgentLoop({ registry: bigRegistry, text: "hello" })

    const tools = bodies[0]?.["tools"] as unknown[]
    expect(tools.length).toBeLessThanOrEqual(128)
  })

  it("never drops extraTools even when connector tools alone exceed the cap", async () => {
    const bigRegistry = { getAllDefTools: () => manyTools(150) } as unknown as ConnectorRegistry
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return okResponse()
    }) as typeof fetch

    await runAgentLoop({ registry: bigRegistry, text: "hello", extraTools: { echo: echoTool } })

    const tools = bodies[0]?.["tools"] as Array<{ function?: { name?: string } }>
    expect(tools.length).toBeLessThanOrEqual(128)
    expect(tools.some((t) => t.function?.name === "echo")).toBe(true)
  })

  it("prefers a connector tool the user's message actually mentions when trimming", async () => {
    const bigRegistry = {
      getAllDefTools: () => manyTools(150, "gmail_search_gmail"),
    } as unknown as ConnectorRegistry
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return okResponse()
    }) as typeof fetch

    await runAgentLoop({ registry: bigRegistry, text: "search my gmail for invoices" })

    const tools = bodies[0]?.["tools"] as Array<{ function?: { name?: string } }>
    expect(tools.some((t) => t.function?.name === "gmail_search_gmail")).toBe(true)
  })

  it("passes every tool through untouched when under the cap", async () => {
    const smallRegistry = { getAllDefTools: () => manyTools(5) } as unknown as ConnectorRegistry
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return okResponse()
    }) as typeof fetch

    await runAgentLoop({ registry: smallRegistry, text: "hello" })

    const tools = bodies[0]?.["tools"] as unknown[]
    expect(tools.length).toBe(5)
  })
})

// Above CLASSIFY_THRESHOLD_TOOLS, a cheap classifier call picks which connected
// connectors this turn needs before the real call — see resolveConnectorTools /
// selectRelevantConnectors in agent.ts. These exercise that path directly
// (distinct from "runAgentLoop tool cap" above, which is the >128 hard limit).
describe("runAgentLoop dynamic connector-tool selection", () => {
  function manyTools(n: number, prefix: string): Record<string, typeof echoTool> {
    const tools: Record<string, typeof echoTool> = {}
    for (let i = 0; i < n; i++) tools[`${prefix}_${i}`] = echoTool
    return tools
  }

  function fakeRegistry(byConnector: Record<string, Record<string, typeof echoTool>>) {
    const summaries = Object.keys(byConnector).map((id) => ({
      id,
      name: id,
      description: `${id} connector`,
    }))
    return {
      getAllDefTools: () => Object.assign({}, ...Object.values(byConnector)),
      getConnectorSummaries: () => summaries,
      getToolsForConnectors: (ids: string[]) =>
        Object.assign({}, ...ids.map((id) => byConnector[id] ?? {})),
    } as unknown as ConnectorRegistry
  }

  function okResponse() {
    return chatResponse({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    })
  }

  function classifyResponse(text: string) {
    return chatResponse({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    })
  }

  it("skips the classifier entirely under the threshold — one fetch call, everything passed through", async () => {
    const registry = fakeRegistry({ slack: manyTools(10, "slack") })
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return okResponse()
    }) as typeof fetch

    await runAgentLoop({ registry, text: "hello" })

    expect(bodies.length).toBe(1) // no classify call
    const tools = bodies[0]?.["tools"] as unknown[]
    expect(tools.length).toBe(10)
  })

  it("above the threshold, loads only the connector(s) the classifier picks", async () => {
    const registry = fakeRegistry({
      slack: manyTools(25, "slack"),
      github: manyTools(25, "github"),
    })
    const bodies: Record<string, unknown>[] = []
    let call = 0
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      return call === 1 ? classifyResponse("github") : okResponse()
    }) as typeof fetch

    await runAgentLoop({ registry, text: "what's the status of my PR?" })

    expect(bodies.length).toBe(2)
    const mainTools = bodies[1]?.["tools"] as Array<{ function?: { name?: string } }>
    expect(mainTools.every((t) => t.function?.name?.startsWith("github_"))).toBe(true)
    expect(mainTools.length).toBe(25)
  })

  it("loads no connector tools when the classifier says NONE, but keeps extraTools", async () => {
    const registry = fakeRegistry({
      slack: manyTools(25, "slack"),
      github: manyTools(25, "github"),
    })
    const bodies: Record<string, unknown>[] = []
    let call = 0
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      return call === 1 ? classifyResponse("NONE") : okResponse()
    }) as typeof fetch

    await runAgentLoop({ registry, text: "what's 2+2?", extraTools: { echo: echoTool } })

    const mainTools = bodies[1]?.["tools"] as Array<{ function?: { name?: string } }>
    expect(mainTools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "echo" }) }),
    ])
  })

  it("keeps a connected connector named in the message even when the classifier says NONE", async () => {
    const registry = fakeRegistry({
      notion: manyTools(25, "notion"),
      slack: manyTools(25, "slack"),
    })
    const bodies: Record<string, unknown>[] = []
    let call = 0
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      return call === 1 ? classifyResponse("NONE") : okResponse()
    }) as typeof fetch

    await runAgentLoop({
      registry,
      text: "add this image to Quick Notes in Notion",
      extraTools: { echo: echoTool },
    })

    const mainTools = bodies[1]?.["tools"] as Array<{ function?: { name?: string } }>
    expect(mainTools.some((t) => t.function?.name?.startsWith("notion_"))).toBe(true)
    expect(mainTools.some((t) => t.function?.name?.startsWith("slack_"))).toBe(false)
    expect(mainTools.some((t) => t.function?.name === "echo")).toBe(true)
  })

  it("adds an explicitly named connector when the classifier picks the wrong one", async () => {
    const registry = fakeRegistry({
      notion: manyTools(20, "notion"),
      slack: manyTools(25, "slack"),
    })
    const bodies: Record<string, unknown>[] = []
    let call = 0
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      return call === 1 ? classifyResponse("slack") : okResponse()
    }) as typeof fetch

    await runAgentLoop({
      registry,
      text: "search my Notion notes",
      extraTools: { echo: echoTool },
    })

    const mainTools = bodies[1]?.["tools"] as Array<{ function?: { name?: string } }>
    expect(mainTools.some((t) => t.function?.name?.startsWith("notion_"))).toBe(true)
    expect(mainTools.some((t) => t.function?.name?.startsWith("slack_"))).toBe(true)
  })

  it("fails open to loading everything when the classifier call itself fails", async () => {
    const registry = fakeRegistry({
      slack: manyTools(25, "slack"),
      github: manyTools(25, "github"),
    })
    const bodies: Record<string, unknown>[] = []
    let call = 0
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      call++
      if (call === 1) return new Response("boom", { status: 500 })
      bodies.push(JSON.parse(String(init?.body)))
      return okResponse()
    }) as typeof fetch

    await runAgentLoop({ registry, text: "hello" })

    const mainTools = bodies[0]?.["tools"] as unknown[]
    expect(mainTools.length).toBe(50) // both connectors' tools, unfiltered
  })
})
