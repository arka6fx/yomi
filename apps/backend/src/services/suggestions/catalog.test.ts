import { describe, expect, it, mock, beforeEach } from "bun:test"

function genRow(over: Record<string, unknown> = {}) {
  return {
    dedupKey: "gen:github:morning",
    title: "GitHub morning digest",
    description: "Your unread PRs each morning.",
    schedule: "every day 8am",
    prompt: "Summarize my GitHub notifications.",
    deliverTo: ["telegram"],
    connector: "github",
    timeBucket: "morning",
    distinctDays: 5,
    generatedAt: new Date(),
    ...over,
  }
}

const state = {
  providers: [] as string[],
  platforms: [] as string[],
  decided: [] as string[],
  generated: [] as ReturnType<typeof genRow>[],
}

mock.module("@yomi/db", () => {
  const resultFor = (table: any) => {
    if (table.__name === "mcp") return state.providers.map((p) => ({ provider: p }))
    if (table.__name === "platform") return state.platforms.map((p) => ({ platform: p }))
    if (table.__name === "generated") return state.generated
    return state.decided.map((k) => ({ dedupKey: k }))
  }
  return {
    db: { select: () => ({ from: (t: any) => ({ where: () => Promise.resolve(resultFor(t)) }) }) },
    mcpConnections: { __name: "mcp", provider: {}, userId: {} },
    platformConnections: { __name: "platform", platform: {}, userId: {} },
    suggestionDecisions: { __name: "decisions", dedupKey: {}, userId: {} },
    generatedSuggestions: {
      __name: "generated",
      userId: {},
      dedupKey: {},
      title: {},
      description: {},
      schedule: {},
      prompt: {},
      deliverTo: {},
      connector: {},
      distinctDays: {},
      generatedAt: {},
    },
  }
})

const { offerableFor, SUGGESTION_CATALOG, findEntry } = await import("./catalog.js")
const { validateScheduleInput } = await import("../schedule-parser.js")

beforeEach(() => {
  state.providers = []
  state.platforms = []
  state.decided = []
  state.generated = []
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

  it("findEntry resolves catalog keys and rejects unknowns", async () => {
    expect((await findEntry("u1", "gmail-daily-briefing-v1"))?.provider).toBe("google")
    expect(await findEntry("u1", "nope")).toBeUndefined()
  })

  it("findEntry resolves a generated key from the user's cache", async () => {
    state.generated = [genRow()]
    const entry = await findEntry("u1", "gen:github:morning")
    expect(entry?.provider).toBe("github")
    expect(entry?.spec.schedule).toBe("every day 8am")
    expect(entry?.requires).toEqual({ telegram: true })
  })

  it("findEntry returns undefined for a generated key absent from cache", async () => {
    state.generated = []
    expect(await findEntry("u1", "gen:linear:evening")).toBeUndefined()
  })

  it("places gated generated suggestions before the catalog floor", async () => {
    state.providers = ["google", "github"]
    state.platforms = ["telegram"]
    state.generated = [genRow()]
    const offers = await offerableFor("u1")
    expect(offers[0]?.dedupKey).toBe("gen:github:morning")
    // catalog entries still follow
    expect(offers.some((e) => e.dedupKey === "gmail-daily-briefing-v1")).toBe(true)
  })

  it("gates generated entries by the same connector/decision rules as the catalog", async () => {
    state.platforms = ["telegram"]
    // github NOT connected -> generated github suggestion is dropped
    state.providers = ["google"]
    state.generated = [genRow()]
    let offers = await offerableFor("u1")
    expect(offers.some((e) => e.dedupKey === "gen:github:morning")).toBe(false)

    // connected but already decided -> still dropped
    state.providers = ["google", "github"]
    state.decided = ["gen:github:morning"]
    offers = await offerableFor("u1")
    expect(offers.some((e) => e.dedupKey === "gen:github:morning")).toBe(false)
  })

  it("ranks generated suggestions by distinctDays descending", async () => {
    state.providers = ["github", "google", "linear"]
    state.platforms = ["telegram"]
    state.generated = [
      genRow({ dedupKey: "gen:github:morning", connector: "github", distinctDays: 3 }),
      genRow({ dedupKey: "gen:google:afternoon", connector: "google", distinctDays: 9 }),
      genRow({ dedupKey: "gen:linear:evening", connector: "linear", distinctDays: 6 }),
    ]
    const offers = await offerableFor("u1")
    expect(offers.slice(0, 3).map((e) => e.dedupKey)).toEqual([
      "gen:google:afternoon",
      "gen:linear:evening",
      "gen:github:morning",
    ])
  })
})
