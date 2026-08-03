import { beforeEach, describe, expect, it, mock } from "bun:test"

let ensureSourceCalls: { userId: string; opts: Record<string, unknown> }[] = []
let ensureSourceResult = "source-1"
mock.module("./source-lookup.js", () => ({
  ensureSource: async (userId: string, opts: Record<string, unknown>) => {
    ensureSourceCalls.push({ userId, opts })
    return ensureSourceResult
  },
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
  ensureSourceCalls = []
  ensureSourceResult = "source-1"
  consentAllowed = true
  consentReason = "not granted"
  consentShouldThrow = false
  indexDocumentResult = { status: "indexed", documentId: "doc-1" }
  indexDocumentShouldThrow = false
  indexDocumentCalls = []
})

describe("ensureManualSource", () => {
  it("calls ensureSource with the fixed Chat notes params", async () => {
    const id = await ensureManualSource("u1")
    expect(id).toBe("source-1")
    expect(ensureSourceCalls).toHaveLength(1)
    expect(ensureSourceCalls[0]!.userId).toBe("u1")
    expect(ensureSourceCalls[0]!.opts).toEqual({
      path: "chat-notes",
      name: "Chat notes",
      sourceType: MANUAL_SOURCE_TYPE,
    })
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
