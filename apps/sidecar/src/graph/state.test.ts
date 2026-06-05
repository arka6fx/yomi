import { describe, expect, it } from "bun:test"
import { StateGraph, START, END } from "@langchain/langgraph"
import type { CoreMessage } from "ai"
import { GraphAnnotation, type GraphState } from "./state.js"

// Exercise the channel reducers through a real compiled graph: list channels append,
// scalar channels last-write-wins.
describe("graph state reducers", () => {
  it("appends messages/toolHistory and last-writes scalars", async () => {
    const m1: CoreMessage = { role: "user", content: "a" }
    const m2: CoreMessage = { role: "assistant", content: "b" }
    const graph = new StateGraph(GraphAnnotation)
      .addNode(
        "one",
        (): Partial<GraphState> => ({
          messages: [m1],
          toolHistory: [{ tool: "x", failed: false }],
          recoveryCount: 1,
          validationStatus: "failed",
        }),
      )
      .addNode(
        "two",
        (): Partial<GraphState> => ({
          messages: [m2],
          toolHistory: [{ tool: "y", failed: true }],
          recoveryCount: 3,
          validationStatus: "passed",
        }),
      )
      .addEdge(START, "one")
      .addEdge("one", "two")
      .addEdge("two", END)
      .compile()

    const out = await graph.invoke({ goal: "g" })
    expect(out.messages.map((m) => m.content)).toEqual(["a", "b"])
    expect(out.toolHistory.map((t) => t.tool)).toEqual(["x", "y"])
    expect(out.recoveryCount).toBe(3) // last write wins
    expect(out.validationStatus).toBe("passed")
    expect(out.goal).toBe("g")
  })

  it("applies declared defaults", async () => {
    const graph = new StateGraph(GraphAnnotation)
      .addNode("noop", (): Partial<GraphState> => ({}))
      .addEdge(START, "noop")
      .addEdge("noop", END)
      .compile()
    const out = await graph.invoke({ goal: "g" })
    expect(out.recoveryCount).toBe(0)
    expect(out.messages).toEqual([])
    expect(out.executionMode).toBe("foreground")
    expect(out.permissionStatus).toBe("none")
    expect(out.failed).toBe(false)
  })
})
