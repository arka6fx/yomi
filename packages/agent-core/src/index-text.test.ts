import { describe, expect, it } from "bun:test"
import { createIndexTextTool, type IndexTextFn } from "./index-text.js"

describe("createIndexTextTool", () => {
  it("returns a tool with the correct shape", () => {
    const indexText: IndexTextFn = async () => ({ ok: true, documentId: "doc-1" })
    const t = createIndexTextTool(indexText)
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("index")
    expect(t.parameters).toBeDefined()
  })

  it("calls the injected indexText callback with title and content", async () => {
    let calledArgs: [string, string] | null = null
    const indexText: IndexTextFn = async (title, content) => {
      calledArgs = [title, content]
      return { ok: true, documentId: "doc-1" }
    }
    const t = createIndexTextTool(indexText)

    const result = await t.execute!(
      { title: "Meeting notes", content: "We decided to ship on Friday." },
      {} as never,
    )

    expect(calledArgs).toEqual(["Meeting notes", "We decided to ship on Friday."])
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  it("passes an error result through unchanged", async () => {
    const indexText: IndexTextFn = async () => ({ error: "cloud memory consent not granted" })
    const t = createIndexTextTool(indexText)

    const result = await t.execute!({ title: "x", content: "y" }, {} as never)

    expect(result).toEqual({ error: "cloud memory consent not granted" })
  })
})
