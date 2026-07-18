import { describe, expect, it, mock, beforeEach } from "bun:test"
import type { GeneratedSuggestion } from "./assemble.js"

const state = { rows: [] as any[] }
const writes = { deletes: 0, inserted: [] as any[] }

const generatedSuggestions = { __t: "gen", userId: {} }

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(state.rows) }) }),
    delete: () => ({
      where: () => {
        writes.deletes++
        return Promise.resolve()
      },
    }),
    insert: () => ({
      values: (rows: any[]) => {
        writes.inserted.push(...rows)
        return Promise.resolve()
      },
    }),
  },
  generatedSuggestions,
}))

const { readGeneratedCache, findGeneratedEntry, writeGeneratedCache } = await import("./cache.js")

function row(over: Record<string, unknown> = {}) {
  return {
    dedupKey: "gen:github:morning",
    title: "GitHub morning digest",
    description: "Your unread PRs each morning.",
    schedule: "every day 8am",
    prompt: "Summarize my GitHub notifications.",
    deliverTo: ["telegram"],
    connector: "github",
    distinctDays: 5,
    generatedAt: new Date("2026-07-18T00:00:00.000Z"),
    ...over,
  }
}

const NOW = new Date("2026-07-18T12:00:00.000Z")

beforeEach(() => {
  state.rows = []
  writes.deletes = 0
  writes.inserted = []
})

describe("readGeneratedCache", () => {
  it("reports a missing cache as stale with no entries", async () => {
    state.rows = []
    const { entries, stale } = await readGeneratedCache("u1", NOW)
    expect(entries).toEqual([])
    expect(stale).toBe(true)
  })

  it("reconstructs a SuggestionEntry with provider and telegram requirement", async () => {
    state.rows = [row()]
    const { entries, stale } = await readGeneratedCache("u1", NOW)
    expect(stale).toBe(false)
    expect(entries[0]).toEqual({
      dedupKey: "gen:github:morning",
      provider: "github",
      title: "GitHub morning digest",
      description: "Your unread PRs each morning.",
      requires: { telegram: true },
      spec: {
        schedule: "every day 8am",
        prompt: "Summarize my GitHub notifications.",
        deliverTo: ["telegram"],
      },
    })
  })

  it("omits requires.telegram when deliverTo has no telegram target", async () => {
    state.rows = [row({ deliverTo: ["email"] })]
    const { entries } = await readGeneratedCache("u1", NOW)
    expect(entries[0]?.requires).toBeUndefined()
  })

  it("marks a cache older than the ~7-day TTL as stale", async () => {
    state.rows = [row({ generatedAt: new Date("2026-07-10T11:00:00.000Z") })] // >7d before NOW
    const { stale } = await readGeneratedCache("u1", NOW)
    expect(stale).toBe(true)
  })

  it("ranks entries by distinctDays descending regardless of row order", async () => {
    state.rows = [
      row({ dedupKey: "gen:github:morning", connector: "github", distinctDays: 3 }),
      row({ dedupKey: "gen:google:afternoon", connector: "google", distinctDays: 9 }),
      row({ dedupKey: "gen:linear:evening", connector: "linear", distinctDays: 6 }),
    ]
    const { entries } = await readGeneratedCache("u1", NOW)
    expect(entries.map((e) => e.dedupKey)).toEqual([
      "gen:google:afternoon",
      "gen:linear:evening",
      "gen:github:morning",
    ])
  })
})

describe("findGeneratedEntry", () => {
  it("resolves a cached key and returns undefined for a missing one", async () => {
    state.rows = [row()]
    expect((await findGeneratedEntry("u1", "gen:github:morning"))?.provider).toBe("github")
    expect(await findGeneratedEntry("u1", "gen:slack:evening")).toBeUndefined()
  })
})

describe("writeGeneratedCache", () => {
  function gen(over: Partial<GeneratedSuggestion> = {}): GeneratedSuggestion {
    return {
      dedupKey: "gen:github:morning",
      provider: "github",
      title: "GitHub morning digest",
      description: "Your unread PRs each morning.",
      spec: { schedule: "every day 8am", prompt: "Summarize.", deliverTo: ["telegram"] },
      connector: "github",
      timeBucket: "morning",
      distinctDays: 5,
      ...over,
    }
  }

  it("replaces the cache: delete then insert flattened rows", async () => {
    await writeGeneratedCache("u1", [gen()])
    expect(writes.deletes).toBe(1)
    expect(writes.inserted).toHaveLength(1)
    expect(writes.inserted[0]).toEqual({
      userId: "u1",
      dedupKey: "gen:github:morning",
      title: "GitHub morning digest",
      description: "Your unread PRs each morning.",
      schedule: "every day 8am",
      prompt: "Summarize.",
      deliverTo: ["telegram"],
      connector: "github",
      timeBucket: "morning",
      distinctDays: 5,
    })
  })

  it("deletes but inserts nothing for an empty set", async () => {
    await writeGeneratedCache("u1", [])
    expect(writes.deletes).toBe(1)
    expect(writes.inserted).toHaveLength(0)
  })
})
