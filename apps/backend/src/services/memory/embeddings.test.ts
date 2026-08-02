import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import {
  MEMORY_EMBEDDING_DIMENSIONS,
  embedMemoryText,
  memoryEmbeddingModel,
  memoryVectorLiteral,
} from "./embeddings.js"

const realFetch = global.fetch
const realKey = process.env["OPENAI_API_KEY"]
const realBaseUrl = process.env["OPENAI_BASE_URL"]
const realModel = process.env["OPENAI_EMBEDDING_MODEL"]

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function embeddingResponse(embedding: number[]): Response {
  return new Response(JSON.stringify({ data: [{ embedding }] }), {
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  process.env["OPENAI_API_KEY"] = "test-key"
  delete process.env["OPENAI_BASE_URL"]
  delete process.env["OPENAI_EMBEDDING_MODEL"]
})

afterEach(() => {
  global.fetch = realFetch
  restoreEnv("OPENAI_API_KEY", realKey)
  restoreEnv("OPENAI_BASE_URL", realBaseUrl)
  restoreEnv("OPENAI_EMBEDDING_MODEL", realModel)
  mock.restore()
})

describe("memoryEmbeddingModel", () => {
  it("defaults to text-embedding-3-small", () => {
    expect(memoryEmbeddingModel()).toBe("text-embedding-3-small")
  })

  it("honours OPENAI_EMBEDDING_MODEL", () => {
    process.env["OPENAI_EMBEDDING_MODEL"] = "text-embedding-3-large"
    expect(memoryEmbeddingModel()).toBe("text-embedding-3-large")
  })
})

describe("embedMemoryText", () => {
  it("returns the embedding for a 1536-dim response", async () => {
    const embedding = Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, i) => i / 10000)
    global.fetch = mock(async () => embeddingResponse(embedding))

    expect(await embedMemoryText("remember this")).toEqual(embedding)
  })

  it("posts the resolved model to the resolved base url", async () => {
    process.env["OPENAI_BASE_URL"] = "https://proxy.example.com/v1///"
    process.env["OPENAI_EMBEDDING_MODEL"] = "text-embedding-3-large"
    let url = ""
    let body: unknown
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input)
      body = JSON.parse(String(init?.body))
      return embeddingResponse(new Array(MEMORY_EMBEDDING_DIMENSIONS).fill(0.1))
    })

    await embedMemoryText("remember this")

    expect(url).toBe("https://proxy.example.com/v1/embeddings")
    expect(body).toEqual({ model: "text-embedding-3-large", input: "remember this" })
  })

  it("returns [] for blank input without calling the API", async () => {
    const fetchMock = mock(async () => embeddingResponse([]))
    global.fetch = fetchMock

    expect(await embedMemoryText("   ")).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns [] when no API key is configured", async () => {
    delete process.env["OPENAI_API_KEY"]
    const fetchMock = mock(async () => embeddingResponse([]))
    global.fetch = fetchMock

    expect(await embedMemoryText("remember this")).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns [] when the API responds with an error", async () => {
    global.fetch = mock(async () => new Response("nope", { status: 500 }))

    expect(await embedMemoryText("remember this")).toEqual([])
  })

  it("returns [] when the embedding has the wrong dimensions", async () => {
    global.fetch = mock(async () => embeddingResponse(new Array(768).fill(0.1)))

    expect(await embedMemoryText("remember this")).toEqual([])
  })
})

describe("memoryVectorLiteral", () => {
  it("formats values as a pgvector literal with 8 decimals", () => {
    expect(memoryVectorLiteral([1, -0.5, 0.123456789])).toBe("[1.00000000,-0.50000000,0.12345679]")
  })

  it("substitutes 0 for non-finite values", () => {
    expect(memoryVectorLiteral([Number.NaN, Number.POSITIVE_INFINITY])).toBe("[0,0]")
  })

  // "[]" is not a literal pgvector accepts — callers must guard on length before querying.
  it("renders an empty vector as []", () => {
    expect(memoryVectorLiteral([])).toBe("[]")
  })
})
