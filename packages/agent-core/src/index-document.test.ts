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

  it("does not mention content or a size limit in the description, since the model never supplies content", () => {
    const indexDocument: IndexDocumentFn = async () => ({ ok: true, documentId: "doc-1" })
    const t = createIndexDocumentTool(indexDocument)
    expect(t.description).not.toContain("content")
    expect(t.description).not.toContain("5-page")
  })

  it("calls the injected indexDocument callback with a caller-supplied title", async () => {
    let calledArgs: (string | undefined)[] = []
    const indexDocument: IndexDocumentFn = async (title) => {
      calledArgs.push(title)
      return { ok: true, documentId: "doc-1" }
    }
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!({ title: "report.pdf" }, {} as never)

    expect(calledArgs).toEqual(["report.pdf"])
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  it("calls the injected indexDocument callback with no title when the model omits it", async () => {
    let calledArgs: (string | undefined)[] = []
    const indexDocument: IndexDocumentFn = async (title) => {
      calledArgs.push(title)
      return { ok: true, documentId: "doc-1" }
    }
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!({}, {} as never)

    expect(calledArgs).toEqual([undefined])
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  it("passes an error result through unchanged", async () => {
    const indexDocument: IndexDocumentFn = async () => ({ error: "failed to index" })
    const t = createIndexDocumentTool(indexDocument)

    const result = await t.execute!({ title: "report.pdf" }, {} as never)

    expect(result).toEqual({ error: "failed to index" })
  })
})
