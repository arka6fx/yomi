import { beforeEach, describe, expect, it, mock } from "bun:test"

let disallowedAddress = false
mock.module("@yomi/agent-core", () => ({
  resolvesToDisallowedAddress: async () => disallowedAddress,
}))

let ensureSourceCalls: { userId: string; opts: Record<string, unknown> }[] = []
mock.module("./source-lookup.js", () => ({
  ensureSource: async (userId: string, opts: Record<string, unknown>) => {
    ensureSourceCalls.push({ userId, opts })
    return "url-source-1"
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

const { fetchAndExtractUrl, indexUrl } = await import("./url-ingest.js")

const realFetch = globalThis.fetch

function htmlResponse(
  body: string,
  init: { status?: number; contentType?: string; contentLength?: string } = {},
): Response {
  const headers = new Headers()
  headers.set("content-type", init.contentType ?? "text/html")
  if (init.contentLength) headers.set("content-length", init.contentLength)
  return new Response(body, { status: init.status ?? 200, headers })
}

// Produces a Response backed by a real streamed ReadableStream that hands out one
// chunk per pull, so tests can assert the reader stops being pulled once the running
// total crosses the size cap (rather than only checking the final byte count).
function streamedResponse(
  chunks: Uint8Array[],
  init: { status?: number; contentType?: string } = {},
): { response: Response; pullCount: () => number } {
  const queue = [...chunks]
  let pulls = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++
      const chunk = queue.shift()
      if (chunk) {
        controller.enqueue(chunk)
      } else {
        controller.close()
      }
    },
  })
  const headers = new Headers()
  headers.set("content-type", init.contentType ?? "text/html")
  const response = new Response(stream, { status: init.status ?? 200, headers })
  return { response, pullCount: () => pulls }
}

beforeEach(() => {
  disallowedAddress = false
  ensureSourceCalls = []
  consentAllowed = true
  consentReason = "not granted"
  consentShouldThrow = false
  indexDocumentResult = { status: "indexed", documentId: "doc-1" }
  indexDocumentShouldThrow = false
  indexDocumentCalls = []
  globalThis.fetch = realFetch
})

describe("fetchAndExtractUrl", () => {
  it("rejects a non-http(s) scheme", async () => {
    const result = await fetchAndExtractUrl("ftp://example.com/file")
    expect(result).toEqual({ error: "only http and https URLs can be indexed" })
  })

  it("rejects an unparseable URL", async () => {
    const result = await fetchAndExtractUrl("not a url")
    expect(result).toEqual({ error: "only http and https URLs can be indexed" })
  })

  it("rejects a URL that resolves to a disallowed address", async () => {
    disallowedAddress = true
    globalThis.fetch = mock(async () => htmlResponse("<html></html>")) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "that URL cannot be fetched" })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("rejects a redirect response", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("", { status: 302 }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "that URL redirects, which isn't supported yet" })
  })

  it("rejects when fetch throws (timeout/network failure)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "failed to fetch that URL" })
  })

  it("rejects a non-2xx response", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("", { status: 500 }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "fetch failed with status 500" })
  })

  it("rejects an unsupported content-type", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("binary", { contentType: "application/pdf" }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/file.pdf")

    expect(result).toEqual({ error: "only HTML and plain-text pages can be indexed" })
  })

  it("rejects an oversized page via Content-Length", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html></html>", { contentLength: "3000000" }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "that page is too large to index" })
  })

  it("rejects an oversized page via actual body size", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("x".repeat(2_000_001)),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "that page is too large to index" })
  })

  it("stops reading the stream once the running total crosses the size cap", async () => {
    // 10 chunks of 500,000 bytes = 5,000,000 total, well over the 2,000,000 cap.
    // The cap is crossed partway through the 5th chunk (2,500,000 > 2,000,000), so
    // an unbounded reader would need to pull all 10; a bounded one should stop early.
    const chunk = new Uint8Array(500_000).fill(120) // 'x'
    const chunks = Array.from({ length: 10 }, () => chunk)
    const { response, pullCount } = streamedResponse(chunks)
    globalThis.fetch = mock(async () => response) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com")

    expect(result).toEqual({ error: "that page is too large to index" })
    const pullsAtReturn = pullCount()
    expect(pullsAtReturn).toBeLessThan(chunks.length)
    // Let any stray microtasks/pulls settle, then confirm reading truly stopped.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pullCount()).toBe(pullsAtReturn)
  })

  it("extracts title and strips HTML tags/scripts/styles", async () => {
    const html =
      "<html><head><title>My Article</title><style>body{color:red}</style></head>" +
      "<body><script>alert(1)</script><h1>Hello</h1><p>World</p></body></html>"
    globalThis.fetch = mock(async () => htmlResponse(html)) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/article")

    expect(result).toEqual({
      title: "My Article",
      text: "Hello World",
      normalizedUrl: "https://example.com/article",
    })
  })

  it("falls back to the URL as the title when no <title> is present", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><body><p>No title here</p></body></html>"),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/no-title")

    expect(result).toEqual({
      title: "https://example.com/no-title",
      text: "No title here",
      normalizedUrl: "https://example.com/no-title",
    })
  })

  it("uses plain-text content as-is, with the URL as title", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("just some plain text", { contentType: "text/plain" }),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/notes.txt")

    expect(result).toEqual({
      title: "https://example.com/notes.txt",
      text: "just some plain text",
      normalizedUrl: "https://example.com/notes.txt",
    })
  })

  it("strips the URL fragment from normalizedUrl", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><title>T</title><body>x</body></html>"),
    ) as unknown as typeof fetch

    const result = await fetchAndExtractUrl("https://example.com/page#section-2")

    expect(result).toEqual({
      title: "T",
      text: "x",
      normalizedUrl: "https://example.com/page",
    })
  })
})

describe("indexUrl", () => {
  it("returns an error and does not fetch when consent is denied", async () => {
    consentAllowed = false
    globalThis.fetch = mock(async () => htmlResponse("<html></html>")) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "cloud memory consent not granted: not granted" })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("passes an extraction error through unchanged", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "failed to fetch that URL" })
    expect(indexDocumentCalls).toHaveLength(0)
  })

  it("indexes successfully using the normalized URL as externalId", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><title>Article</title><body>Body text</body></html>"),
    ) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com/article#top")

    expect(result).toEqual({ ok: true, documentId: "doc-1", title: "Article" })
    expect(indexDocumentCalls).toHaveLength(1)
    const call = indexDocumentCalls[0]!
    expect(call["userId"]).toBe("u1")
    expect(call["externalId"]).toBe("https://example.com/article")
    expect(call["title"]).toBe("Article")
    expect(call["mimeType"]).toBe("text/html")
    expect(ensureSourceCalls).toEqual([
      { userId: "u1", opts: { path: "indexed-urls", name: "Indexed URLs", sourceType: "url" } },
    ])
  })

  it("re-indexing the same URL reuses the same externalId", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><title>Article</title><body>Body text</body></html>"),
    ) as unknown as typeof fetch

    await indexUrl("u1", "https://example.com/article")
    await indexUrl("u1", "https://example.com/article")

    expect(indexDocumentCalls).toHaveLength(2)
    expect(indexDocumentCalls[0]!["externalId"]).toBe(indexDocumentCalls[1]!["externalId"])
  })

  it("returns an error when indexDocument returns no documentId", async () => {
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><body>x</body></html>"),
    ) as unknown as typeof fetch
    indexDocumentResult = { status: "unchanged", documentId: null }

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "failed to index" })
  })

  it("returns an error instead of throwing when an unexpected exception occurs", async () => {
    globalThis.fetch = mock(async () => {
      throw { notAnError: true }
    }) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "failed to fetch that URL" })
  })

  it("returns an error instead of throwing when checkConsent rejects", async () => {
    consentShouldThrow = true
    globalThis.fetch = mock(async () => htmlResponse("<html></html>")) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "failed to index" })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(indexDocumentCalls).toHaveLength(0)
  })

  it("returns an error instead of throwing when indexDocument rejects", async () => {
    indexDocumentShouldThrow = true
    globalThis.fetch = mock(async () =>
      htmlResponse("<html><title>Article</title><body>Body text</body></html>"),
    ) as unknown as typeof fetch

    const result = await indexUrl("u1", "https://example.com")

    expect(result).toEqual({ error: "failed to index" })
  })
})
