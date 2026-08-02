import { beforeEach, describe, it, expect, afterEach, mock } from "bun:test"
import type { SQL } from "drizzle-orm"

let executeRows: unknown[] = []
let executedStatements: unknown[] = []
let executeFails = false

mock.module("@yomi/db", () => ({
  db: {
    execute: async (statement: unknown) => {
      executedStatements.push(statement)
      if (executeFails) throw new Error("query failed")
      return { rows: executeRows }
    },
  },
}))

const { buildRecallCte, memorySearchKnobs, searchMemoryEntries } = await import("./search.js")

beforeEach(() => {
  executeRows = []
  executedStatements = []
  executeFails = false
  delete process.env["OPENAI_API_KEY"]
})

// The knobs reach Postgres as bare numeric chunks, so the emitted numbers are readable
// without rendering the statement through a dialect.
function numbersIn(fragment: SQL): number[] {
  const found: number[] = []
  const walk = (chunks: unknown[]) => {
    for (const chunk of chunks) {
      if (typeof chunk === "number") found.push(chunk)
      else if (chunk && typeof chunk === "object" && "queryChunks" in chunk) {
        walk((chunk as { queryChunks: unknown[] }).queryChunks)
      }
    }
  }
  walk((fragment as unknown as { queryChunks: unknown[] }).queryChunks)
  return found
}

function textIn(fragment: SQL): string {
  const parts: string[] = []
  const walk = (chunks: unknown[]) => {
    for (const chunk of chunks) {
      if (chunk && typeof chunk === "object" && "value" in chunk) {
        const value = (chunk as { value: unknown }).value
        if (Array.isArray(value)) parts.push(value.join(""))
      } else if (chunk && typeof chunk === "object" && "queryChunks" in chunk) {
        walk((chunk as { queryChunks: unknown[] }).queryChunks)
      }
    }
  }
  walk((fragment as unknown as { queryChunks: unknown[] }).queryChunks)
  return parts.join("").replace(/\s+/g, " ")
}

const ORIGINAL_CANDIDATES = process.env["MEMORY_CANDIDATES"]
const ORIGINAL_RRF_K = process.env["MEMORY_RRF_K"]

function restoreEnv() {
  if (ORIGINAL_CANDIDATES === undefined) delete process.env["MEMORY_CANDIDATES"]
  else process.env["MEMORY_CANDIDATES"] = ORIGINAL_CANDIDATES
  if (ORIGINAL_RRF_K === undefined) delete process.env["MEMORY_RRF_K"]
  else process.env["MEMORY_RRF_K"] = ORIGINAL_RRF_K
}

describe("memorySearchKnobs", () => {
  afterEach(restoreEnv)

  it("defaults to 30 candidates and an RRF k of 60", () => {
    delete process.env["MEMORY_CANDIDATES"]
    delete process.env["MEMORY_RRF_K"]
    expect(memorySearchKnobs()).toEqual({ candidates: 30, rrfK: 60 })
  })

  it("resolves both knobs from the environment", () => {
    process.env["MEMORY_CANDIDATES"] = "77"
    process.env["MEMORY_RRF_K"] = "12"
    expect(memorySearchKnobs()).toEqual({ candidates: 77, rrfK: 12 })
  })

  it("clamps a candidate count below the floor back up to it", () => {
    process.env["MEMORY_CANDIDATES"] = "2"
    expect(memorySearchKnobs().candidates).toBe(5)
  })

  it("clamps an RRF k below the floor back up to it", () => {
    process.env["MEMORY_RRF_K"] = "-4"
    expect(memorySearchKnobs().rrfK).toBe(1)
  })

  it("falls back to the defaults when the values are not numbers", () => {
    process.env["MEMORY_CANDIDATES"] = "not-a-number"
    process.env["MEMORY_RRF_K"] = "not-a-number"
    expect(memorySearchKnobs()).toEqual({ candidates: 30, rrfK: 60 })
  })
})

describe("buildRecallCte", () => {
  const base = {
    userId: "u1",
    query: "vim",
    queryEmbedding: [],
    knobs: { candidates: 77, rrfK: 12 },
    fusedLimit: 8,
    metaColumns: ["topic", "content"] as const,
  }

  it("carries the candidate count into every shortlisting arm", () => {
    const numbers = numbersIn(buildRecallCte(base))
    // full-text and metadata arms; the vector arm is absent with no embedding
    expect(numbers.filter((n) => n === 77)).toHaveLength(2)
  })

  it("carries the candidate count into the vector arm when there is an embedding", () => {
    const numbers = numbersIn(buildRecallCte({ ...base, queryEmbedding: [0.1, 0.2] }))
    expect(numbers.filter((n) => n === 77)).toHaveLength(3)
  })

  it("fuses the arms with the configured RRF k", () => {
    expect(numbersIn(buildRecallCte(base))).toContain(12)
  })

  it("limits the fused set independently of the candidate count", () => {
    expect(numbersIn(buildRecallCte({ ...base, fusedLimit: 8 }))).toContain(8)
  })

  it("scans only the metadata columns it was given", () => {
    const narrow = textIn(buildRecallCte(base))
    expect(narrow).toContain("e.topic ilike")
    expect(narrow).not.toContain("e.summary ilike")

    const wide = textIn(
      buildRecallCte({ ...base, metaColumns: ["topic", "summary", "source_path"] as const }),
    )
    expect(wide).toContain("e.summary ilike")
    expect(wide).toContain("e.source_path ilike")
  })
})

describe("searchMemoryEntries", () => {
  it("passes the limit through as the fused-CTE candidate count and the final limit", async () => {
    await searchMemoryEntries("u1", "editor", 12)

    const numbers: number[] = []
    const walk = (chunks: unknown[]) => {
      for (const chunk of chunks) {
        if (typeof chunk === "number") numbers.push(chunk)
        else if (chunk && typeof chunk === "object" && "queryChunks" in chunk) {
          walk((chunk as { queryChunks: unknown[] }).queryChunks)
        }
      }
    }
    for (const statement of executedStatements) {
      if (statement && typeof statement === "object" && "queryChunks" in statement) {
        walk((statement as { queryChunks: unknown[] }).queryChunks)
      }
    }
    expect(numbers).toContain(12)
  })

  it("returns the rows the query produces", async () => {
    executeRows = [
      {
        kind: "preference",
        topic: "editor",
        content: "uses vim",
        sourcePath: null,
        isStatic: false,
        updatedAt: "2026-07-01T00:00:00Z",
        score: 0.9,
        matchedBy: ["full_text"],
      },
    ]

    const rows = await searchMemoryEntries("u1", "editor", 8)

    expect(rows).toEqual(executeRows)
  })

  it("returns no rows for an empty query", async () => {
    expect(await searchMemoryEntries("u1", "   ", 8)).toEqual([])
    expect(executedStatements).toEqual([])
  })

  it("returns no rows when the query fails, rather than throwing", async () => {
    executeFails = true

    expect(await searchMemoryEntries("u1", "editor", 8)).toEqual([])
  })
})
