import { describe, expect, it } from "bun:test"
import { createIndexUrlTool, type IndexUrlFn } from "./index-url.js"

describe("createIndexUrlTool", () => {
  it("returns a tool with the correct shape", () => {
    const indexUrl: IndexUrlFn = async () => ({
      ok: true,
      documentId: "doc-1",
      title: "Article",
    })
    const t = createIndexUrlTool(indexUrl)
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("URL")
    expect(t.parameters).toBeDefined()
  })

  it("calls the injected indexUrl callback with the url", async () => {
    let calledUrl: string | null = null
    const indexUrl: IndexUrlFn = async (url) => {
      calledUrl = url
      return { ok: true, documentId: "doc-1", title: "Article" }
    }
    const t = createIndexUrlTool(indexUrl)

    const result = await t.execute!({ url: "https://example.com/article" }, {} as never)

    expect(calledUrl).toBe("https://example.com/article")
    expect(result).toEqual({ ok: true, documentId: "doc-1", title: "Article" })
  })

  it("passes an error result through unchanged", async () => {
    const indexUrl: IndexUrlFn = async () => ({ error: "that URL cannot be fetched" })
    const t = createIndexUrlTool(indexUrl)

    const result = await t.execute!({ url: "https://example.com" }, {} as never)

    expect(result).toEqual({ error: "that URL cannot be fetched" })
  })
})
