import { afterEach, describe, expect, it } from "bun:test"
import {
  createWebSearchTool,
  parseResponsesOutput,
  searchWeb,
  type WebSearchFn,
} from "./web-search.js"

const originalFetch = globalThis.fetch
const originalApiKey = process.env["OPENAI_API_KEY"]

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env["OPENAI_API_KEY"] = originalApiKey
})

describe("createWebSearchTool", () => {
  it("returns a tool with the correct shape", () => {
    const search: WebSearchFn = async () => ({ answer: "", citations: [] })
    const tool = createWebSearchTool(search)
    expect(tool).toBeDefined()
    expect(typeof tool.description).toBe("string")
    expect(tool.description).toContain("web")
    expect(tool.parameters).toBeDefined()
  })

  it("calls search with the provided query and returns its result", async () => {
    let calledQuery = ""
    const fakeResult = {
      answer: "Yomi shipped web search this week.",
      citations: [{ title: "Yomi changelog", url: "https://getyomi.in/changelog" }],
    }
    const search: WebSearchFn = async (query) => {
      calledQuery = query
      return fakeResult
    }

    const tool = createWebSearchTool(search)
    const result = await tool.execute!({ query: "what's new in yomi" }, {} as never)

    expect(calledQuery).toBe("what's new in yomi")
    expect(result).toEqual(fakeResult)
  })

  it("returns empty citations when the search finds nothing", async () => {
    const search: WebSearchFn = async () => ({ answer: "No results found.", citations: [] })
    const tool = createWebSearchTool(search)
    const result = await tool.execute!({ query: "asdkjqwleuhrqlkwuehr" }, {} as never)
    expect(result).toEqual({ answer: "No results found.", citations: [] })
  })
})

// Fixture shapes come from OpenAI's Responses API web_search tool docs
// (developers.openai.com/api/docs/guides/tools-web-search).
describe("parseResponsesOutput", () => {
  it("extracts the answer text and url citations from a message item", () => {
    const output = [
      {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "positive news today" },
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Scientists found a new treatment.",
            annotations: [
              {
                type: "url_citation",
                start_index: 0,
                end_index: 34,
                url: "https://example.com/news",
                title: "Example News",
              },
            ],
          },
        ],
      },
    ]

    const result = parseResponsesOutput(output)

    expect(result.answer).toBe("Scientists found a new treatment.")
    expect(result.citations).toEqual([{ title: "Example News", url: "https://example.com/news" }])
  })

  it("returns an empty answer and no citations when there's no message item", () => {
    const output = [
      {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "x" },
      },
    ]
    const result = parseResponsesOutput(output)
    expect(result).toEqual({ answer: "", citations: [] })
  })

  it("falls back to the url when a citation has no title", () => {
    const output = [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Answer.",
            annotations: [{ type: "url_citation", url: "https://example.com/untitled" }],
          },
        ],
      },
    ]
    const result = parseResponsesOutput(output)
    expect(result.citations).toEqual([
      { title: "https://example.com/untitled", url: "https://example.com/untitled" },
    ])
  })
})

describe("searchWeb", () => {
  it("posts the query to the Responses API with the web_search tool enabled", async () => {
    process.env["OPENAI_API_KEY"] = "test-key"
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | null = null
    let capturedAuth: string | undefined
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      capturedAuth = new Headers(init?.headers).get("authorization") ?? undefined
      return new Response(
        JSON.stringify({
          output: [
            { type: "message", content: [{ type: "output_text", text: "ok", annotations: [] }] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as typeof fetch

    const result = await searchWeb("current weather in Bengaluru")

    expect(capturedUrl).toBe("https://api.openai.com/v1/responses")
    expect(capturedAuth).toBe("Bearer test-key")
    expect(capturedBody).not.toBeNull()
    expect(capturedBody!["input"]).toBe("current weather in Bengaluru")
    expect(capturedBody!["tools"]).toEqual([{ type: "web_search" }])
    expect(result.answer).toBe("ok")
  })

  it("throws with the response body when the request fails", async () => {
    process.env["OPENAI_API_KEY"] = "test-key"
    globalThis.fetch = (async () =>
      new Response("insufficient_quota", {
        status: 429,
        statusText: "Too Many Requests",
      })) as typeof fetch

    await expect(searchWeb("anything")).rejects.toThrow(/429/)
  })
})
