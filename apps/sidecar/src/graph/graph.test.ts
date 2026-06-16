// Keep the Knowledge Base writes from Completion off disk during tests.
process.env.YOMI_KNOWLEDGE_DB = ":memory:"
process.env.YOMI_AUTOMATION_DB = ":memory:"
import { afterEach, describe, expect, it } from "bun:test"
import { jsonSchema, tool, type LanguageModelV1, type ToolSet } from "ai"
import { MockLanguageModelV1 } from "ai/test"
import { simulateReadableStream } from "ai"
import type { SseEvent } from "@yomi/shared"
import { buildGraph } from "./graph.js"
import { EventBridge } from "./events.js"
import { startAutomationRun } from "../automation/runs.js"
import { LoopGuards } from "../harness/guards.js"
import type { Hooks } from "../harness/hooks.js"
import type { GraphDeps } from "./deps.js"
import { __resetAutomationRunsForTest } from "../automation/runs.js"

const fakeHooks: Hooks = {
  onSessionStart: async () => {},
  onUserPromptSubmit: async () => {},
  onPreToolUse: async () => ({ ok: true }),
  onPostToolUse: async (_t, r) => r,
  onStop: async () => {},
  onSessionEnd: async () => {},
}

// A model that streams a bit of text then stops — no tool calls (clean success).
function textOnlyModel(text: string): LanguageModelV1 {
  return new MockLanguageModelV1({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-delta", textDelta: text },
          { type: "finish", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 } },
        ],
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  })
}

// A model that always calls the same tool with the same args — trips the duplicate LoopGuard.
function loopingToolModel(toolName: string): LanguageModelV1 {
  return new MockLanguageModelV1({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "tool-call", toolCallType: "function", toolCallId: "c1", toolName, args: "{}" },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 1, completionTokens: 1 },
          },
        ],
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  })
}

const noopTools: ToolSet = {
  noop: tool({
    description: "test tool that reports failure",
    parameters: jsonSchema<Record<string, never>>({
      type: "object",
      properties: {},
      additionalProperties: false,
    }),
    execute: async () => ({ ok: false, error: "always fails" }),
  }),
}

function makeDeps(opts: {
  goal: string
  model: LanguageModelV1
  modelCalls?: { n: number }
  requestApproval?: (l: string, r: string) => Promise<boolean>
}): { deps: GraphDeps; events: SseEvent[] } {
  const events: SseEvent[] = []
  const emit = (e: SseEvent) => events.push(e)
  const automation = startAutomationRun(opts.goal)
  const calls = opts.modelCalls ?? { n: 0 }
  const deps: GraphDeps = {
    req: { text: opts.goal },
    emit,
    hooks: fakeHooks,
    guards: new LoopGuards(),
    automation,
    bridge: new EventBridge(automation, emit),
    modelFactory: () => {
      calls.n++
      return opts.model
    },
    toolsPromise: Promise.resolve(noopTools),
    // uia — desktop automation disabled
    writeTurn: async () => {},
    requestApproval: opts.requestApproval ?? (async () => true),
    markClosed: () => {},
  }
  return { deps, events }
}

function run(deps: GraphDeps, goal: string) {
  return buildGraph(deps).invoke({ taskId: "t", goal }, { recursionLimit: 50 })
}

afterEach(() => {
  delete process.env["YOMI_GRAPH_APPROVAL_GATE"]
  __resetAutomationRunsForTest()
})

const graphDescribe_ = describe
graphDescribe_("agent graph", () => {
  it("runs a clean task to completion", async () => {
    const { deps, events } = makeDeps({
      goal: "summarize this page",
      model: textOnlyModel("all done"),
    })
    const out = await run(deps, "summarize this page")
    expect(out.failed).toBe(false)
    expect(out.agentStatus).toBe("completed")
    expect(out.validationStatus).toBe("passed")
    expect(events.some((e) => e.type === "agent_text" && e.text === "all done")).toBe(true)
    expect(events.some((e) => e.type === "automation_completed")).toBe(true)
    expect(events.some((e) => e.type === "automation_failed")).toBe(false)
  })

  it("recovers on failure, increments recoveryCount, and escalates at the cap without looping", async () => {
    const modelCalls = { n: 0 }
    const { deps, events } = makeDeps({
      goal: "research the topic",
      model: loopingToolModel("noop"),
      modelCalls,
    })
    const out = await run(deps, "research the topic")
    expect(out.failed).toBe(true)
    expect(out.recoveryCount).toBe(2) // MAX_RECOVERIES default
    const recovering = events.filter((e) => e.type === "automation_recovering")
    expect(recovering.length).toBe(2)
    expect(events.some((e) => e.type === "automation_failed")).toBe(true)
    // Execution ran 3 times (initial + 2 recoveries); proves no infinite loop.
    expect(modelCalls.n).toBe(3)
  })

  it("blocks on denied approval and never executes", async () => {
    process.env["YOMI_GRAPH_APPROVAL_GATE"] = "1"
    const modelCalls = { n: 0 }
    const { deps, events } = makeDeps({
      goal: "send the report to my team",
      model: textOnlyModel("should not run"),
      modelCalls,
      requestApproval: async () => false,
    })
    const out = await run(deps, "send the report to my team")
    expect(out.permissionStatus).toBe("denied")
    expect(out.failed).toBe(true)
    expect(modelCalls.n).toBe(0) // execution never reached
    const failed = events.find((e) => e.type === "automation_failed")
    expect(failed && failed.type === "automation_failed" && failed.error).toContain(
      "Approval denied",
    )
  })

  it("proceeds to execution when approval is granted", async () => {
    process.env["YOMI_GRAPH_APPROVAL_GATE"] = "1"
    const modelCalls = { n: 0 }
    const { deps } = makeDeps({
      goal: "send the report to my team",
      model: textOnlyModel("sent"),
      modelCalls,
      requestApproval: async () => true,
    })
    const out = await run(deps, "send the report to my team")
    expect(out.permissionStatus).toBe("granted")
    expect(out.failed).toBe(false)
    expect(modelCalls.n).toBe(1)
  })
})
