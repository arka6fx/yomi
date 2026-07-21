import { describe, expect, it } from "bun:test"
import { suggestIntegrationsFor } from "./integration-catalog.js"

describe("suggestIntegrationsFor", () => {
  it("matches a single-word connector name named directly in the text", () => {
    const result = suggestIntegrationsFor("can you check my Trello board", [])
    expect(result.some((s) => s.id === "trello")).toBe(true)
  })

  it("matches one word of a multi-word connector name", () => {
    const result = suggestIntegrationsFor("what's on my calendar today", [])
    expect(result.some((s) => s.id === "google-calendar")).toBe(true)
  })

  it("does not match a short name as a substring inside an unrelated word", () => {
    const result = suggestIntegrationsFor("give me an example of this", [])
    expect(result.some((s) => s.id === "exa")).toBe(false)
  })

  it("returns an empty array for a message that names nothing connector-related", () => {
    const result = suggestIntegrationsFor("what's the weather like today", [])
    expect(result).toEqual([])
  })

  it("excludes already-connected connectors even when named in the text", () => {
    const result = suggestIntegrationsFor("can you check my Trello board", ["trello"])
    expect(result.some((s) => s.id === "trello")).toBe(false)
  })

  it("excludes swiggy even when named and unconnected", () => {
    const result = suggestIntegrationsFor("order food from Swiggy", [])
    expect(result.some((s) => s.id === "swiggy")).toBe(false)
  })

  it("caps results at 3 when the message names more than 3 unconnected connectors", () => {
    const result = suggestIntegrationsFor(
      "connect this to Trello, Jira, Asana, and Notion",
      [],
    )
    expect(result.length).toBe(3)
  })
})
