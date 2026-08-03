import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectRows: { id: string; status?: string }[] = []
// Returned by the second (fallback, post-conflict) select call, distinct from
// the first (initial lookup) call so a test can drive them down different paths.
let fallbackSelectRows: { id: string; status?: string }[] = []
let selectCallCount = 0
let insertedSources: Record<string, unknown>[] = []
let nextSourceId = 1
let insertConflicts = false
let updateCalls: Record<string, unknown>[] = []

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            selectCallCount++
            return Promise.resolve(selectCallCount === 1 ? selectRows : fallbackSelectRows)
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (insertConflicts) return Promise.resolve([])
            const id = `source-${nextSourceId++}`
            insertedSources.push({ id, ...v })
            return Promise.resolve([{ id, ...v }])
          },
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push(v)
          return Promise.resolve()
        },
      }),
    }),
  },
  ragSources: { __name: "rag_sources" },
}))

let consentAllowed = true
let consentReason: string | null = "not granted"
let consentShouldThrow = false
mock.module("../privacy/checks.js", () => ({
  checkConsent: async () => {
    if (consentShouldThrow) throw new Error("db connection blip")
    return { allowed: consentAllowed, reason: consentReason }
  },
}))

let indexDocumentResult: { status: "indexed" | "unchanged"; documentId: string | null } = {
  status: "indexed",
  documentId: "doc-1",
}
let indexDocumentShouldThrow = false
let indexDocumentCalls: Record<string, unknown>[] = []
mock.module("./index-document.js", () => ({
  indexDocument: async (input: Record<string, unknown>) => {
    indexDocumentCalls.push(input)
    if (indexDocumentShouldThrow) throw new Error("db write failed")
    return indexDocumentResult
  },
}))

const { MANUAL_SOURCE_TYPE, ensureManualSource, indexManualText } =
  await import("./manual-source.js")

beforeEach(() => {
  selectRows = []
  fallbackSelectRows = []
  selectCallCount = 0
  insertedSources = []
  nextSourceId = 1
  insertConflicts = false
  updateCalls = []
  consentAllowed = true
  consentReason = "not granted"
  consentShouldThrow = false
  indexDocumentResult = { status: "indexed", documentId: "doc-1" }
  indexDocumentShouldThrow = false
  indexDocumentCalls = []
})

describe("ensureManualSource", () => {
  it("creates a source on first call", async () => {
    const id = await ensureManualSource("u1")
    expect(id).toBe("source-1")
    expect(insertedSources).toHaveLength(1)
    expect(insertedSources[0]!["sourceType"]).toBe(MANUAL_SOURCE_TYPE)
    expect(insertedSources[0]!["userId"]).toBe("u1")
  })

  it("reuses the existing source on a later call", async () => {
    selectRows = [{ id: "existing-source" }]
    const id = await ensureManualSource("u1")
    expect(id).toBe("existing-source")
    expect(insertedSources).toHaveLength(0)
  })

  it("does not reuse a soft-deleted source", async () => {
    // The real lookup filters on ne(status, "deleted"), so a soft-deleted row at this
    // path never matches — modeled here by an empty select result, which drives
    // ensureManualSource down the insert path instead of reusing the deleted row's id.
    selectRows = []
    const id = await ensureManualSource("u1")
    expect(id).toBe("source-1")
    expect(id).not.toBe("existing-deleted-source")
    expect(insertedSources).toHaveLength(1)
    expect(insertedSources[0]!["path"]).toBe("chat-notes")
  })

  it("resurrects a soft-deleted source when the insert conflicts on a deleted row's slot", async () => {
    // Initial lookup excludes the deleted row (empty), so ensureManualSource attempts
    // an insert. That insert loses the unique-constraint race because a soft-deleted
    // row already occupies (userId, path) — the fallback re-select (unfiltered) finds
    // it, and since it's "deleted" the function must resurrect rather than return it
    // as-is or fail outright.
    selectRows = []
    fallbackSelectRows = [{ id: "deleted-source", status: "deleted" }]
    insertConflicts = true

    const id = await ensureManualSource("u1")

    expect(id).toBe("deleted-source")
    expect(insertedSources).toHaveLength(0)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!["status"]).toBe("ready")
    expect(updateCalls[0]!["updatedAt"]).toBeInstanceOf(Date)
  })
})

describe("indexManualText", () => {
  it("returns an error and does not call indexDocument when consent is denied", async () => {
    consentAllowed = false

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "cloud memory consent not granted: not granted" })
    expect(indexDocumentCalls).toHaveLength(0)
  })

  it("indexes the text under the manual source with a fresh externalId", async () => {
    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ ok: true, documentId: "doc-1" })
    expect(indexDocumentCalls).toHaveLength(1)
    const call = indexDocumentCalls[0]!
    expect(call["userId"]).toBe("u1")
    expect(call["title"]).toBe("Notes")
    expect(call["text"]).toBe("some content")
    expect(call["mimeType"]).toBe("text/plain")
    expect(typeof call["externalId"]).toBe("string")
    expect((call["externalId"] as string).length).toBeGreaterThan(10)
  })

  it("uses a distinct externalId on each call, so repeated pastes never overwrite", async () => {
    await indexManualText("u1", "Notes", "first paste")
    await indexManualText("u1", "Notes", "second paste")

    expect(indexDocumentCalls).toHaveLength(2)
    expect(indexDocumentCalls[0]!["externalId"]).not.toBe(indexDocumentCalls[1]!["externalId"])
  })

  it("returns an error when indexDocument returns no documentId", async () => {
    indexDocumentResult = { status: "unchanged", documentId: null }

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when indexDocument rejects", async () => {
    indexDocumentShouldThrow = true

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when checkConsent rejects", async () => {
    consentShouldThrow = true

    const result = await indexManualText("u1", "Notes", "some content")

    expect(result).toEqual({ error: "failed to index" })
    expect(indexDocumentCalls).toHaveLength(0)
  })
})
