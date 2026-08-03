import { describe, expect, it } from "bun:test"
import { createIndexDocumentTool, type IndexDocumentFn } from "./index-document.js"

describe("createIndexDocumentTool", () => {
  it("returns a tool with the correct shape", () => {
    const indexDocument: IndexDocumentFn = async () => ({ ok: true, documentId: "doc-1" })
    const t = createIndexDocumentTool(indexDocument)
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("document")
    expect(t.parameters).toBeDefined()
  })

  it("calls the injected indexDocument callback with title and content", async () => {
    let calledArgs: { title: string; content: string } | null = null
    const indexDocument: IndexDocumentFn = async (title, content) => {
      calledArgs = { title, content }
      return { ok: true, documentId: "doc-1" }
    }
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!(
      { title: "report.pdf", content: "extracted document text" },
      {} as never,
    )

    expect(calledArgs).toEqual({ title: "report.pdf", content: "extracted document text" })
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  it("passes an error result through unchanged", async () => {
    const indexDocument: IndexDocumentFn = async () => ({ error: "failed to index" })
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!({ title: "report.pdf", content: "text" }, {} as never)

    expect(result).toEqual({ error: "failed to index" })
  })
})
