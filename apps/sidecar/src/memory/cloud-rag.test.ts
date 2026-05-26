import { afterEach, describe, expect, it, mock } from "bun:test"
import { retrieveCloudRagContext } from "./cloud-rag.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("retrieveCloudRagContext", () => {
  it("does not call the backend when disabled", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("{}")))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const context = await retrieveCloudRagContext({ query: "docs", enabled: false, authToken: "token" })

    expect(context).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not call the backend without a token", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("{}")))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const context = await retrieveCloudRagContext({ query: "docs", enabled: true })

    expect(context).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("formats returned snippets into prompt context", async () => {
    globalThis.fetch = mock(() => Promise.resolve(Response.json({
      snippets: [
        { title: "plan.md", content: "Use local memory first." },
        { title: "pricing.md", content: "Pro has Cloud RAG." },
      ],
    }))) as unknown as typeof fetch

    const context = await retrieveCloudRagContext({ query: "memory", enabled: true, authToken: "token" })

    expect(context).toContain("- plan.md: Use local memory first.")
    expect(context).toContain("- pricing.md: Pro has Cloud RAG.")
  })

  it("returns empty context when the backend rejects the search", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response("{}", { status: 403 }))) as unknown as typeof fetch

    const context = await retrieveCloudRagContext({ query: "memory", enabled: true, authToken: "token" })

    expect(context).toBe("")
  })

  it("caps formatted snippets by maxChars", async () => {
    globalThis.fetch = mock(() => Promise.resolve(Response.json({
      snippets: [
        { title: "short.md", content: "fits" },
        { title: "long.md", content: "x".repeat(100) },
      ],
    }))) as unknown as typeof fetch

    const context = await retrieveCloudRagContext({ query: "memory", enabled: true, authToken: "token", maxChars: 30 })

    expect(context).toBe("- short.md: fits")
  })
})
