import { beforeEach, describe, expect, it } from "bun:test"

// Use an isolated in-memory db; set before importing so getDb() picks it up on first call.
process.env.YOMI_KNOWLEDGE_DB = ":memory:"
const {
  recordWorkflow,
  recordRecovery,
  recallKnowledge,
  knowledgeHint,
  goalKeyOf,
  __resetKnowledgeForTest,
} = await import("./knowledge.js")

beforeEach(() => __resetKnowledgeForTest())

function wf(over: Partial<Parameters<typeof recordWorkflow>[0]> = {}) {
  recordWorkflow({
    agentId: "spotify",
    goal: "play lofi beats on spotify",
    goalKey: goalKeyOf("play lofi beats on spotify"),
    tools: ["play_spotify"],
    stepCount: 1,
    recoveryCount: 0,
    durationMs: 1200,
    outcome: "success",
    summary: "started lofi",
    ...over,
  })
}

describe("goalKeyOf", () => {
  it("normalizes to lowercase alnum tokens", () => {
    expect(goalKeyOf("Play LOFI, beats!! on Spotify")).toBe("play lofi beats on spotify")
  })
})

describe("workflow recall", () => {
  it("recalls a prior successful workflow ranked by token overlap", () => {
    wf()
    wf({
      goal: "send a whatsapp to alex",
      goalKey: goalKeyOf("send a whatsapp to alex"),
      agentId: "messaging",
    })
    const recall = recallKnowledge("spotify", "play some lofi on spotify")
    expect(recall.workflows.length).toBe(1)
    expect(recall.workflows[0]!.tools).toEqual(["play_spotify"])
  })

  it("ignores failures and other agents", () => {
    wf({ outcome: "failure" })
    expect(recallKnowledge("spotify", "play lofi on spotify").workflows.length).toBe(0)
    wf({ agentId: "browser" })
    expect(recallKnowledge("spotify", "play lofi on spotify").workflows.length).toBe(0)
  })

  it("returns nothing when no goal tokens overlap", () => {
    wf()
    expect(recallKnowledge("spotify", "reboot the router").workflows.length).toBe(0)
  })
})

describe("recovery recall", () => {
  it("recalls a learned recovery for a similar goal", () => {
    recordRecovery({
      agentId: "windows",
      goalKey: goalKeyOf("save the notepad draft"),
      error: "tool set_value failed",
      strategy: "use type_text instead of set_value",
    })
    const recall = recallKnowledge("windows", "save my notepad draft now")
    expect(recall.recoveries.length).toBe(1)
    expect(recall.recoveries[0]!.strategy).toContain("type_text")
  })

  it("does not store an empty strategy", () => {
    recordRecovery({ agentId: "windows", goalKey: "x y z", error: "e", strategy: "  " })
    expect(recallKnowledge("windows", "x y z").recoveries.length).toBe(0)
  })
})

describe("knowledgeHint", () => {
  it("renders a bounded prompt block from recall", () => {
    wf()
    recordRecovery({
      agentId: "spotify",
      goalKey: goalKeyOf("play lofi on spotify"),
      error: "no window",
      strategy: "launch Spotify first",
    })
    const hint = knowledgeHint(recallKnowledge("spotify", "play lofi on spotify"))
    expect(hint).toContain("Prior success")
    expect(hint).toContain("play_spotify")
    expect(hint).toContain("launch Spotify first")
  })

  it("is null when there is nothing to recall", () => {
    expect(knowledgeHint({ workflows: [], recoveries: [] })).toBeNull()
  })
})
