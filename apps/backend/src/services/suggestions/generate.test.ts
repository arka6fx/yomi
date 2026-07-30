import { describe, expect, it, mock, beforeEach } from "bun:test"
import type { EarnedPattern } from "./earned-patterns.js"
import type { ModelSuggestionSlot } from "./assemble.js"

// --- mutable test state ------------------------------------------------------
const state = {
  patterns: [] as EarnedPattern[],
  connectors: [] as { provider: string }[],
  latched: [] as { dedupKey: string }[],
  focuses: [] as { topic: string; summary: string | null }[],
  memoryAllowed: true,
  cloudMemoryAllowed: true,
  modelOutput: [] as ModelSuggestionSlot[],
  modelThrows: false,
}
const memReads = { count: 0 } // times memory_entries was queried
const genCalls: Array<{ system?: string; prompt?: string }> = []
const telemetry: Array<Record<string, unknown>> = []
const metering = { chargeCalled: false }
const cache = { deletes: 0, inserted: [] as any[] } // generated-suggestions cache writes

// Distinct table sentinels so the db mock can route .from(table) to the right rows.
const mcpConnections = { __t: "mcp" }
const memoryEntries = {
  __t: "mem",
  topic: {},
  summary: {},
  userId: {},
  status: {},
  isLatest: {},
  isStatic: {},
  confidence: {},
  updatedAt: {},
}
const suggestionDecisions = { __t: "dec" }
const generatedSuggestions = { __t: "gen", userId: {} }

// Thenable query builder that ignores where/orderBy/limit and resolves to `rows`.
function q(rows: unknown[]) {
  const p = Promise.resolve(rows)
  const b = {
    from: () => b,
    where: () => b,
    orderBy: () => b,
    limit: () => b,
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  }
  return b
}

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({
      from: (table: { __t: string }) => {
        if (table === memoryEntries) {
          memReads.count++
          return q(state.focuses)
        }
        if (table === mcpConnections) return q(state.connectors)
        if (table === suggestionDecisions) return q(state.latched)
        return q([])
      },
    }),
    delete: () => ({
      where: () => {
        cache.deletes++
        return Promise.resolve()
      },
    }),
    insert: () => ({
      values: (rows: any[]) => {
        cache.inserted.push(...rows)
        return Promise.resolve()
      },
    }),
  },
  mcpConnections,
  memoryEntries,
  suggestionDecisions,
  generatedSuggestions,
}))

mock.module("@yomi/agent-core", () => ({
  createModel: (model: string) => model,
}))

mock.module("ai", () => ({
  jsonSchema: (s: unknown) => s,
  generateObject: async (opts: { system?: string; prompt?: string }) => {
    genCalls.push({ system: opts.system, prompt: opts.prompt })
    if (state.modelThrows) throw new Error("model exploded")
    return {
      object: { suggestions: state.modelOutput },
      usage: { promptTokens: 100, completionTokens: 40 },
    }
  },
}))

mock.module("../ai-telemetry.js", () => ({
  recordAiUsage: async (input: Record<string, unknown>) => {
    telemetry.push(input)
  },
}))

mock.module("../privacy/checks.js", () => ({
  checkConsent: async (_userId: string, purpose: string) => {
    if (purpose === "memory") return { allowed: state.memoryAllowed, reason: null, decided: true }
    if (purpose === "cloud_memory")
      return { allowed: state.cloudMemoryAllowed, reason: null, decided: true }
    return { allowed: false, reason: null, decided: false }
  },
}))

mock.module("../metering.js", () => ({
  chargeUsage: async () => {
    metering.chargeCalled = true
    return { ok: true }
  },
}))

mock.module("./earned-patterns.js", () => ({
  earnedPatterns: async () => state.patterns,
}))

const { generateSuggestions, regenerateGeneratedCache } = await import("./generate.js")

const NOW = new Date("2026-07-17T12:00:00.000Z")

function pattern(over: Partial<EarnedPattern> = {}): EarnedPattern {
  return { connector: "github", timeBucket: "morning", distinctDays: 5, ...over }
}
function slot(over: Partial<ModelSuggestionSlot> = {}): ModelSuggestionSlot {
  return {
    connector: "github",
    timeBucket: "morning",
    title: "GitHub morning digest",
    description: "Every morning, your unread PRs and review requests.",
    schedule: "every day 8am",
    prompt: "Summarize my unread GitHub notifications.",
    deliverTo: ["telegram"],
    ...over,
  }
}

beforeEach(() => {
  state.patterns = []
  state.connectors = []
  state.latched = []
  state.focuses = []
  state.memoryAllowed = true
  state.cloudMemoryAllowed = true
  state.modelOutput = []
  state.modelThrows = false
  memReads.count = 0
  genCalls.length = 0
  telemetry.length = 0
  metering.chargeCalled = false
  cache.deletes = 0
  cache.inserted = []
})

describe("generateSuggestions", () => {
  it("returns validated SuggestionEntry[] for a user", async () => {
    state.patterns = [pattern()]
    state.connectors = [{ provider: "github" }]
    state.modelOutput = [slot()]

    const result = await generateSuggestions("u1", NOW)

    expect(result).toHaveLength(1)
    expect(result[0]!.dedupKey).toBe("gen:github:morning")
    expect(result[0]!.spec.schedule).toBe("every day 8am")
  })

  it("makes no model call when nothing is earned", async () => {
    state.patterns = []
    const result = await generateSuggestions("u1", NOW)
    expect(result).toEqual([])
    expect(genCalls).toHaveLength(0)
    expect(telemetry).toHaveLength(0)
  })

  it("invokes a single generateObject call with only the earned patterns", async () => {
    state.patterns = [pattern({ connector: "github", timeBucket: "morning" })]
    state.connectors = [{ provider: "github" }]
    state.modelOutput = [slot()]

    await generateSuggestions("u1", NOW)

    expect(genCalls).toHaveLength(1)
    expect(genCalls[0]!.prompt).toContain("connector=github")
    expect(genCalls[0]!.prompt).not.toContain("gitlab")
    expect(genCalls[0]!.prompt).not.toContain("connector=google")
  })

  it("drops a malformed model schedule via Seam 2 (phrasing boundary)", async () => {
    state.patterns = [pattern()]
    state.connectors = [{ provider: "github" }]
    state.modelOutput = [slot({ schedule: "sometime soon" })]

    const result = await generateSuggestions("u1", NOW)
    expect(result).toEqual([])
  })

  it("degrades to telemetry-only when memory consent is absent — reads no memory", async () => {
    state.patterns = [pattern()]
    state.connectors = [{ provider: "github" }]
    state.modelOutput = [slot()]
    state.memoryAllowed = false
    state.cloudMemoryAllowed = false
    state.focuses = [{ topic: "secret-project", summary: "confidential" }]

    const result = await generateSuggestions("u1", NOW)

    expect(result).toHaveLength(1) // still produced
    expect(memReads.count).toBe(0) // no memory_entries read
    expect(genCalls[0]!.prompt).not.toContain("secret-project")
  })

  it("reads memory focuses when cloud_memory consent alone is present", async () => {
    state.patterns = [pattern()]
    state.connectors = [{ provider: "github" }]
    state.modelOutput = [slot()]
    state.memoryAllowed = false
    state.cloudMemoryAllowed = true
    state.focuses = [{ topic: "thesis", summary: "due friday" }]

    await generateSuggestions("u1", NOW)

    expect(memReads.count).toBe(1)
    expect(genCalls[0]!.prompt).toContain("thesis: due friday")
  })

  it("records an uncharged ai_usage_events row and never touches metering", async () => {
    state.patterns = [pattern()]
    state.connectors = [{ provider: "github" }]
    state.modelOutput = [slot()]

    await generateSuggestions("u1", NOW)

    expect(telemetry).toHaveLength(1)
    expect(telemetry[0]!["surface"]).toBe("backend")
    expect(telemetry[0]!["creditsCharged"]).toBe(0)
    expect(telemetry[0]!["status"]).toBe("done")
    expect(metering.chargeCalled).toBe(false)
  })

  it("records an uncharged error row and returns [] when the model call throws", async () => {
    state.patterns = [pattern()]
    state.connectors = [{ provider: "github" }]
    state.modelThrows = true

    const result = await generateSuggestions("u1", NOW)

    expect(result).toEqual([])
    expect(telemetry).toHaveLength(1)
    expect(telemetry[0]!["status"]).toBe("error")
    expect(telemetry[0]!["creditsCharged"]).toBe(0)
    expect(metering.chargeCalled).toBe(false)
  })
})

describe("regenerateGeneratedCache", () => {
  it("persists fresh suggestions (delete + insert) with source-pattern metadata", async () => {
    state.patterns = [pattern()]
    state.connectors = [{ provider: "github" }]
    state.modelOutput = [slot()]

    await regenerateGeneratedCache("u1", NOW)

    expect(cache.deletes).toBe(1)
    expect(cache.inserted).toHaveLength(1)
    expect(cache.inserted[0]).toMatchObject({
      userId: "u1",
      dedupKey: "gen:github:morning",
      connector: "github",
      timeBucket: "morning",
      distinctDays: 5,
      schedule: "every day 8am",
    })
  })

  it("clears the cache (delete, no insert) when nothing is earned", async () => {
    state.patterns = []

    await regenerateGeneratedCache("u1", NOW)

    expect(cache.deletes).toBe(1)
    expect(cache.inserted).toHaveLength(0)
  })
})
