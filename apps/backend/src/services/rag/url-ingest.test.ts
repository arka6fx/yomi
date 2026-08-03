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
mock.module("../privacy/checks.js", () => ({
  checkConsent: async () => ({ allowed: consentAllowed, reason: consentReason }),
}))

let indexDocumentResult: { status: "indexed" | "unchanged"; documentId: string | null } = {
  status: "indexed",
  documentId: "doc-1",
}
let indexDocumentCalls: Record<string, unknown>[] = []
mock.module("./index-document.js", () => ({
  indexDocument: async (input: Record<string, unknown>) => {
    indexDocumentCalls.push(input)
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

beforeEach(() => {
  disallowedAddress = false
  ensureSourceCalls = []
  consentAllowed = true
  consentReason = "not granted"
  indexDocumentResult = { status: "indexed", documentId: "doc-1" }
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
})
