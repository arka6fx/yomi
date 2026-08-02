import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { MEMORY_EMBEDDING_DIMENSIONS } from "./embeddings.js"

// The candidate set is the recall ceiling on contradiction detection (ADR 0006), so these
// tests pin what is retrieved, what is shown to the model, and that a failure yields an empty
// set rather than an exception the extraction path would swallow along with the whole turn.

type SqlCall = { text: string; values: unknown[] }

let sqlCalls: SqlCall[] = []
let executeRows: unknown[] = []
let executeFails = false

const realFetch = global.fetch
const realKey = process.env["OPENAI_API_KEY"]

mock.module("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { text: strings.join("?"), values }
    sqlCalls.push(call)
    return call
  },
}))

mock.module("@yomi/db", () => ({
  db: {
    execute: async () => {
      if (executeFails) throw new Error("query failed")
      return executeRows
    },
  },
  memoryEntries: {},
  memoryEmbeddings: {},
}))

const {
  TURN_CANDIDATE_LIMIT,
  buildExtractionPrompt,
  fetchTurnCandidates,
  parseExtractedMemories,
  renderTurnCandidates,
  pickReplacesId,
  resolveIsStatic,
} = await import("./contradiction.js")

function embeddingResponse(): Response {
  return new Response(
    JSON.stringify({ data: [{ embedding: new Array(MEMORY_EMBEDDING_DIMENSIONS).fill(0.01) }] }),
    { headers: { "Content-Type": "application/json" } },
  )
}

function row(over: Partial<Record<string, unknown>> & { id: string }): Record<string, unknown> {
  return {
    kind: "preference",
    topic: "editor",
    summary: null,
    content: "uses vim",
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  }
}

let embeddedInputs: string[] = []

beforeEach(() => {
  sqlCalls = []
  executeRows = []
  executeFails = false
  embeddedInputs = []
  process.env["OPENAI_API_KEY"] = "test-key"
  global.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    embeddedInputs.push(String((JSON.parse(String(init?.body)) as { input?: string }).input))
    return embeddingResponse()
  }) as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = realFetch
  if (realKey === undefined) delete process.env["OPENAI_API_KEY"]
  else process.env["OPENAI_API_KEY"] = realKey
})

describe("fetchTurnCandidates", () => {
  it("returns the nearest active memories for the turn", async () => {
    executeRows = [row({ id: "m1", topic: "editor" }), row({ id: "m2", topic: "coffee order" })]

    const candidates = await fetchTurnCandidates("u1", "User: vs code now\nAssistant: noted")

    expect(candidates.map((c) => c.id)).toEqual(["m1", "m2"])
    expect(candidates[0]).toMatchObject({ topic: "editor", content: "uses vim" })
  })

  // Real corrections are terse ("actually, VS Code now") — the assistant's reply is what
  // restates the subject, so embedding the user message alone retrieves nothing.
  it("embeds the whole turn, not just the user message", async () => {
    await fetchTurnCandidates("u1", "User: actually vs code now\nAssistant: switching you off vim")

    expect(embeddedInputs).toEqual(["User: actually vs code now\nAssistant: switching you off vim"])
  })

  it("reads only the caller's active latest memories", async () => {
    await fetchTurnCandidates("u1", "User: hi\nAssistant: hello")

    const query = sqlCalls.at(-1)!
    expect(query.values).toContain("u1")
    expect(query.text).toContain("status = 'active'")
    expect(query.text).toContain("is_latest = true")
  })

  it("retrieves 20 candidates by default", async () => {
    await fetchTurnCandidates("u1", "User: hi\nAssistant: hello")

    expect(TURN_CANDIDATE_LIMIT).toBe(20)
    expect(sqlCalls.at(-1)!.values).toContain(20)
  })

  it("returns no candidates when the turn cannot be embedded", async () => {
    delete process.env["OPENAI_API_KEY"]

    expect(await fetchTurnCandidates("u1", "User: hi\nAssistant: hello")).toEqual([])
    expect(sqlCalls).toEqual([])
  })

  it("returns no candidates when the query fails, rather than throwing", async () => {
    executeFails = true

    expect(await fetchTurnCandidates("u1", "User: hi\nAssistant: hello")).toEqual([])
  })

  it("returns no candidates for an empty turn", async () => {
    expect(await fetchTurnCandidates("u1", "   ")).toEqual([])
  })
})

describe("renderTurnCandidates", () => {
  it("shows each candidate's id so the model can name one", () => {
    const rendered = renderTurnCandidates([
      { id: "m1", kind: "preference", topic: "editor", summary: null, content: "uses vim" },
      { id: "m2", kind: "fact", topic: "commute", summary: null, content: "cycles to work" },
    ])

    expect(rendered).toContain("m1")
    expect(rendered).toContain("editor")
    expect(rendered).toContain("uses vim")
    expect(rendered).toContain("m2")
  })

  it("says so plainly when nothing is stored yet", () => {
    expect(renderTurnCandidates([])).toContain("none")
  })
})

describe("buildExtractionPrompt", () => {
  const candidates = [
    { id: "m1", kind: "preference", topic: "editor", summary: null, content: "uses vim" },
  ]

  it("shows the candidates and asks for the replaced memory by id", () => {
    const prompt = buildExtractionPrompt("actually vs code now", "noted, vs code it is", candidates)

    expect(prompt).toContain("id=m1")
    expect(prompt).toContain("replaces_id")
    expect(prompt).toContain("actually vs code now")
    expect(prompt).toContain("noted, vs code it is")
  })

  // The blind topic-string guess it replaces could only match by luck (ADR 0006).
  it("no longer asks for a topic string to replace", () => {
    expect(buildExtractionPrompt("hi", "hello", candidates)).not.toContain("replaces_topic")
  })

  // Kept in sync with the "Memory contradiction" section of CONTEXT.md — if these drift, the
  // model starts superseding elaborations.
  it("carries the contradiction, duplicate and elaboration distinction", () => {
    const prompt = buildExtractionPrompt("hi", "hello", candidates)

    expect(prompt).toContain("contradiction")
    expect(prompt).toContain("duplicate")
    expect(prompt).toContain("elaboration")
  })

  // Kept in sync with the Static entry of CONTEXT.md's "Memory contradiction" section — if
  // this drifts, the model starts marking ordinary preferences static (#87).
  it("asks for is_static and states the identity/standing-fact rule, not a kind-based one", () => {
    const prompt = buildExtractionPrompt("hi", "hello", candidates)

    expect(prompt).toContain("is_static")
    expect(prompt).toContain("identity")
    expect(prompt).toContain("standing")
  })
})

describe("parseExtractedMemories", () => {
  it("reads the memories the model returned", () => {
    const parsed = parseExtractedMemories(
      '{"memories":[{"topic":"editor","content":"uses vs code","replaces_id":"m1"}]}',
    )
    expect(parsed).toEqual([{ topic: "editor", content: "uses vs code", replaces_id: "m1" }])
  })

  it("returns nothing for output that is not the expected JSON", () => {
    expect(parseExtractedMemories("sorry, I can't")).toEqual([])
    expect(parseExtractedMemories('{"notes":[]}')).toEqual([])
  })
})

describe("pickReplacesId", () => {
  const candidates = [
    { id: "m1", kind: "preference", topic: "editor", summary: null, content: "uses vim" },
  ]

  it("accepts an id the model was shown", () => {
    expect(pickReplacesId("m1", candidates)).toBe("m1")
  })

  // A supersession destroys a live memory, so an id that was never on screen is a
  // hallucination and must not be acted on.
  it("rejects an id that was not among the candidates", () => {
    expect(pickReplacesId("m9", candidates)).toBeUndefined()
  })

  it("rejects a missing or non-string id", () => {
    expect(pickReplacesId(undefined, candidates)).toBeUndefined()
    expect(pickReplacesId("", candidates)).toBeUndefined()
    expect(pickReplacesId(42, candidates)).toBeUndefined()
  })
})

describe("resolveIsStatic", () => {
  it("accepts the model's true judgment", () => {
    expect(resolveIsStatic({ is_static: true })).toBe(true)
  })

  it("defaults an ordinary extracted preference to false", () => {
    expect(resolveIsStatic({ kind: "preference", is_static: false })).toBe(false)
  })

  // The bug #87 fixes: static must not fall out of kind alone.
  it("does not infer static from kind, even for preference or fact", () => {
    expect(resolveIsStatic({ kind: "preference" })).toBe(false)
    expect(resolveIsStatic({ kind: "fact" })).toBe(false)
  })

  it("defaults a missing or malformed judgment to false", () => {
    expect(resolveIsStatic({})).toBe(false)
    expect(resolveIsStatic({ is_static: "true" })).toBe(false)
    expect(resolveIsStatic({ is_static: 1 })).toBe(false)
  })
})
