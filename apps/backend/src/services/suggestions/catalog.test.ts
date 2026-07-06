import { describe, expect, it, mock, beforeEach } from "bun:test"

const state = { providers: [] as string[], platforms: [] as string[], decided: [] as string[] }

mock.module("@yomi/db", () => {
  const resultFor = (table: any) => {
    if (table.__name === "mcp") return state.providers.map((p) => ({ provider: p }))
    if (table.__name === "platform") return state.platforms.map((p) => ({ platform: p }))
    return state.decided.map((k) => ({ dedupKey: k }))
  }
  return {
    db: { select: () => ({ from: (t: any) => ({ where: () => Promise.resolve(resultFor(t)) }) }) },
    mcpConnections: { __name: "mcp", provider: {}, userId: {} },
    platformConnections: { __name: "platform", platform: {}, userId: {} },
    suggestionDecisions: { __name: "decisions", dedupKey: {}, userId: {} },
  }
})

const { offerableFor, SUGGESTION_CATALOG, findEntry } = await import("./catalog.js")
const { validateScheduleInput } = await import("../schedule-parser.js")

beforeEach(() => {
  state.providers = []
  state.platforms = []
  state.decided = []
})

describe("catalog", () => {
  it("every catalog schedule phrase parses", () => {
    for (const entry of SUGGESTION_CATALOG) {
      const valid = validateScheduleInput(entry.spec.schedule)
      expect(valid.ok).toBe(true)
    }
  })

  it("offers connector entries only when connected and telegram is linked", async () => {
    state.providers = ["google"]
    state.platforms = ["telegram"]
    const offers = await offerableFor("u1")
    expect(offers.some((e) => e.dedupKey === "gmail-daily-briefing-v1")).toBe(true)
    expect(offers.some((e) => e.dedupKey === "github-daily-notifications-v1")).toBe(false)
  })

  it("hides telegram-gated entries when telegram is not linked", async () => {
    state.providers = ["google"]
    state.platforms = []
    const offers = await offerableFor("u1")
    expect(offers.length).toBe(0)
  })

  it("excludes decided keys", async () => {
    state.providers = ["google"]
    state.platforms = ["telegram"]
    state.decided = ["gmail-daily-briefing-v1"]
    const offers = await offerableFor("u1")
    expect(offers.some((e) => e.dedupKey === "gmail-daily-briefing-v1")).toBe(false)
  })

  it("findEntry resolves keys and rejects unknowns", () => {
    expect(findEntry("gmail-daily-briefing-v1")?.provider).toBe("google")
    expect(findEntry("nope")).toBeUndefined()
  })
})
