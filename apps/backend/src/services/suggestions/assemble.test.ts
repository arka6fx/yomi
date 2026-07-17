import { describe, expect, it } from "bun:test"
import { assembleGeneratedSuggestions, dedupKeyFor } from "./assemble.js"
import type { AssemblyContext, ModelSuggestionSlot } from "./assemble.js"
import type { EarnedPattern } from "./earned-patterns.js"

function pattern(over: Partial<EarnedPattern> = {}): EarnedPattern {
  return { connector: "github", timeBucket: "morning", distinctDays: 5, ...over }
}

function slot(over: Partial<ModelSuggestionSlot> = {}): ModelSuggestionSlot {
  return {
    connector: "github",
    timeBucket: "morning",
    title: "GitHub morning digest",
    description: "Every weekday at 8am, your unread PRs and review requests.",
    schedule: "every day 8am",
    prompt: "Summarize my unread GitHub notifications.",
    deliverTo: ["telegram"],
    ...over,
  }
}

function context(over: Partial<AssemblyContext> = {}): AssemblyContext {
  return { connectedConnectors: ["github"], latchedKeys: [], existingSchedules: [], ...over }
}

describe("assembleGeneratedSuggestions", () => {
  it("computes dedupKey as gen:{connector}:{timeBucket} from the pattern, not model prose", () => {
    const p = pattern({ connector: "google", timeBucket: "evening" })
    const result = assembleGeneratedSuggestions(
      [p],
      context({ connectedConnectors: ["google"] }),
      [slot({ connector: "google", timeBucket: "evening" })],
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.dedupKey).toBe("gen:google:evening")
    expect(dedupKeyFor(p)).toBe("gen:google:evening")
  })

  it("identity is independent of the model's title/description/topic wording", () => {
    const p = pattern()
    const a = assembleGeneratedSuggestions([p], context(), [
      slot({ title: "Repo yomi PR digest", description: "About the yomi repo." }),
    ])
    const b = assembleGeneratedSuggestions([p], context(), [
      slot({ title: "Your GitHub mornings", description: "Totally different words." }),
    ])
    expect(a[0]!.dedupKey).toBe(b[0]!.dedupKey)
  })

  it("drops a candidate whose model schedule string is invalid", () => {
    const result = assembleGeneratedSuggestions([pattern()], context(), [
      slot({ schedule: "every blue moon" }),
    ])
    expect(result).toHaveLength(0)
  })

  it("drops a candidate whose connector is not currently connected", () => {
    const result = assembleGeneratedSuggestions(
      [pattern({ connector: "linear" })],
      context({ connectedConnectors: ["github"] }),
      [slot({ connector: "linear" })],
    )
    expect(result).toHaveLength(0)
  })

  it("drops a candidate whose dedupKey collides with an existing latch", () => {
    const result = assembleGeneratedSuggestions(
      [pattern()],
      context({ latchedKeys: ["gen:github:morning"] }),
      [slot()],
    )
    expect(result).toHaveLength(0)
  })

  it("drops a candidate overlapping an existing enabled schedule (connector + bucket)", () => {
    const result = assembleGeneratedSuggestions(
      [pattern()],
      context({ existingSchedules: [{ connector: "github", timeBucket: "morning", enabled: true }] }),
      [slot()],
    )
    expect(result).toHaveLength(0)
  })

  it("keeps a candidate when the existing schedule is a different bucket or connector", () => {
    const result = assembleGeneratedSuggestions(
      [pattern()],
      context({
        existingSchedules: [
          { connector: "github", timeBucket: "evening", enabled: true },
          { connector: "google", timeBucket: "morning", enabled: true },
        ],
      }),
      [slot()],
    )
    expect(result).toHaveLength(1)
  })

  it("ignores a disabled overlapping schedule (only enabled ones dedup)", () => {
    const result = assembleGeneratedSuggestions(
      [pattern()],
      context({ existingSchedules: [{ connector: "github", timeBucket: "morning", enabled: false }] }),
      [slot()],
    )
    expect(result).toHaveLength(1)
  })

  it("ranks survivors by distinctDays descending", () => {
    const patterns = [
      pattern({ connector: "github", timeBucket: "morning", distinctDays: 3 }),
      pattern({ connector: "google", timeBucket: "afternoon", distinctDays: 9 }),
      pattern({ connector: "linear", timeBucket: "evening", distinctDays: 6 }),
    ]
    const result = assembleGeneratedSuggestions(
      patterns,
      context({ connectedConnectors: ["github", "google", "linear"] }),
      [
        slot({ connector: "github", timeBucket: "morning" }),
        slot({ connector: "google", timeBucket: "afternoon" }),
        slot({ connector: "linear", timeBucket: "evening" }),
      ],
    )
    expect(result.map((e) => e.dedupKey)).toEqual([
      "gen:google:afternoon",
      "gen:linear:evening",
      "gen:github:morning",
    ])
  })

  it("caps the result at 3 even when more patterns survive", () => {
    const buckets = ["morning", "afternoon", "evening"] as const
    const patterns: EarnedPattern[] = []
    const slots: ModelSuggestionSlot[] = []
    const connectors = ["github", "google", "linear", "slack"]
    let days = 10
    for (const connector of connectors) {
      for (const timeBucket of buckets) {
        patterns.push(pattern({ connector, timeBucket, distinctDays: days-- }))
        slots.push(slot({ connector, timeBucket }))
      }
    }
    const result = assembleGeneratedSuggestions(
      patterns,
      context({ connectedConnectors: connectors }),
      slots,
    )
    expect(result).toHaveLength(3)
  })

  it("sets requires.telegram when deliverTo includes telegram, omits it otherwise", () => {
    const tg = assembleGeneratedSuggestions([pattern()], context(), [slot({ deliverTo: ["telegram"] })])
    expect(tg[0]!.requires).toEqual({ telegram: true })
    const desktop = assembleGeneratedSuggestions([pattern()], context(), [
      slot({ deliverTo: ["desktop"] }),
    ])
    expect(desktop[0]!.requires).toBeUndefined()
  })

  it("carries the SuggestionEntry shape with provider set to the pattern connector", () => {
    const result = assembleGeneratedSuggestions([pattern()], context(), [slot()])
    const entry = result[0]!
    expect(entry.provider).toBe("github")
    expect(entry.spec).toEqual({
      schedule: "every day 8am",
      prompt: "Summarize my unread GitHub notifications.",
      deliverTo: ["telegram"],
    })
  })

  it("drops a pattern the model produced no phrasing slot for", () => {
    const result = assembleGeneratedSuggestions([pattern()], context(), [])
    expect(result).toHaveLength(0)
  })

  it("prefers a valid slot over an invalid sibling for the same pattern", () => {
    const result = assembleGeneratedSuggestions([pattern()], context(), [
      slot({ schedule: "every blue moon", title: "bad" }),
      slot({ schedule: "every day 8am", title: "good" }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe("good")
  })
})
