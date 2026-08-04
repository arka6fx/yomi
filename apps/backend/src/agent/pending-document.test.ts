import { beforeEach, describe, expect, it, mock } from "bun:test"

let indexUploadedDocumentResult: { ok: true; documentId: string } | { error: string } = {
  ok: true,
  documentId: "doc-1",
}
let indexUploadedDocumentCalls: { userId: string; title: string; content: string }[] = []
mock.module("../services/rag/document-source.js", () => ({
  indexUploadedDocument: async (userId: string, title: string, content: string) => {
    indexUploadedDocumentCalls.push({ userId, title, content })
    return indexUploadedDocumentResult
  },
}))

const { resolvePendingDocumentIndex } = await import("./pending-document.js")

beforeEach(() => {
  indexUploadedDocumentResult = { ok: true, documentId: "doc-1" }
  indexUploadedDocumentCalls = []
})

describe("resolvePendingDocumentIndex", () => {
  it("returns an error and does not call indexUploadedDocument when consumePendingDocument is undefined", async () => {
    const result = await resolvePendingDocumentIndex("u1", undefined, undefined, undefined)

    expect(result).toEqual({
      error: "No recently uploaded document found — ask the user to re-upload it.",
    })
    expect(indexUploadedDocumentCalls).toHaveLength(0)
  })

  it("returns an error and does not call indexUploadedDocument when consumePendingDocument returns null", async () => {
    const consume = () => null

    const result = await resolvePendingDocumentIndex("u1", undefined, consume, undefined)

    expect(result).toEqual({
      error: "No recently uploaded document found — ask the user to re-upload it.",
    })
    expect(indexUploadedDocumentCalls).toHaveLength(0)
  })

  it("calls indexUploadedDocument with the pending document's title/content when no title override is given", async () => {
    const consume = () => ({ title: "report.pdf", content: "extracted text" })

    const result = await resolvePendingDocumentIndex("u1", undefined, consume, undefined)

    expect(result).toEqual({ ok: true, documentId: "doc-1" })
    expect(indexUploadedDocumentCalls).toEqual([
      { userId: "u1", title: "report.pdf", content: "extracted text" },
    ])
  })

  it("uses the caller-supplied title override instead of the pending document's title", async () => {
    const consume = () => ({ title: "report.pdf", content: "extracted text" })

    await resolvePendingDocumentIndex("u1", "My Custom Title", consume, undefined)

    expect(indexUploadedDocumentCalls).toEqual([
      { userId: "u1", title: "My Custom Title", content: "extracted text" },
    ])
  })

  it("does not call restorePendingDocument on a successful index", async () => {
    const consume = () => ({ title: "report.pdf", content: "extracted text" })
    let restoreCalls: { title: string; content: string }[] = []
    const restore = (document: { title: string; content: string }) => {
      restoreCalls.push(document)
    }

    await resolvePendingDocumentIndex("u1", undefined, consume, restore)

    expect(restoreCalls).toHaveLength(0)
  })

  it("calls restorePendingDocument with the exact consumed document on a failed index", async () => {
    indexUploadedDocumentResult = { error: "cloud memory consent not granted" }
    const consume = () => ({ title: "report.pdf", content: "extracted text" })
    let restoreCalls: { title: string; content: string }[] = []
    const restore = (document: { title: string; content: string }) => {
      restoreCalls.push(document)
    }

    const result = await resolvePendingDocumentIndex("u1", undefined, consume, restore)

    expect(result).toEqual({ error: "cloud memory consent not granted" })
    expect(restoreCalls).toEqual([{ title: "report.pdf", content: "extracted text" }])
  })

  it("does not throw when restorePendingDocument is undefined and the index fails", async () => {
    indexUploadedDocumentResult = { error: "failed to index" }
    const consume = () => ({ title: "report.pdf", content: "extracted text" })

    const result = await resolvePendingDocumentIndex("u1", undefined, consume, undefined)

    expect(result).toEqual({ error: "failed to index" })
  })
})
