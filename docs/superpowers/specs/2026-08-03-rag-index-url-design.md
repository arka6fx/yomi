# RAG ingestion beyond Drive — sub-item 2: URL (`index_url`) — design

Status: approved Date: 2026-08-03 Backlog ref: `docs/agentic-backlog.md` item 10

## Problem

Sub-item 1 (`index_text`, merged) let the agent index arbitrary pasted text.
There's still no way for a user to say "index this article" and have Yomi fetch
a URL, extract its readable content, and store it in the same
`rag_documents`/`rag_chunks` pipeline `rag_search`/`deep_research`/passive
injection all read from.

## Goal

An `index_url` tool the backend agent can call to fetch a URL, extract its text
content, and index it — gated by the same consent/plan checks as `index_text`,
and safe against SSRF (a user-supplied URL is fetched server-side, which is a
real attack surface if unguarded).

## Non-goals

- JavaScript-rendered pages (no headless browser). A URL whose content is
  entirely client-rendered will index as near-empty — acceptable for v1.
- PDF or other binary content at a URL — sub-item 3 handles PDFs (uploaded via
  chat); a URL that happens to point at a PDF is rejected here on content-type,
  not routed to sub-item 3's logic.
- A new HTML-parsing dependency (Readability, cheerio, jsdom, etc.). Reuses the
  regex-based strip-tags approach already shipped in `gateway-runner.ts`'s
  `parseDocument` for Telegram document uploads.
- True streaming size cutoff. The fetch fully buffers the response body, then
  checks its size as a backstop (see Fetch bounds) — simpler, and the
  `Content-Length` pre-check already rejects the common case (a server that
  reports its size) before any download happens.

## Refactor: extract `manual-source.ts`'s hardened get-or-create

`manual-source.ts` (sub-item 1) already has a hardened, path-keyed,
status-filtered, race-safe get-or-create for one specific source ("Chat notes").
`index_url` needs the identical logic for a second, different source ("Indexed
URLs") — copying the ~45 lines a second time would mean the next bug fix (there
was one, in review, for sub-item 1) has to land twice. Extracted into a new
shared file:

`apps/backend/src/services/rag/source-lookup.ts`:

````ts
export async function ensureSource(
  userId: string,
  opts: { path: string; name: string; sourceType: string },
): Promise<string>
```//
Same body as the current `ensureManualSource`, generalized to take
`path`/`name`/`sourceType` as parameters instead of file-level constants.

`manual-source.ts` shrinks to a thin wrapper:
```ts
export async function ensureManualSource(userId: string): Promise<string> {
  return ensureSource(userId, {
    path: MANUAL_SOURCE_PATH,
    name: MANUAL_SOURCE_NAME,
    sourceType: MANUAL_SOURCE_TYPE,
  })
}
````

`indexManualText` is otherwise unchanged. This is a pure extraction — no
behavior change to sub-item 1, verified by its existing test suite passing
unmodified against the new indirection.

## SSRF protection

The central risk this sub-item introduces: a user-supplied URL is fetched by the
server. Two layers:

1. **Before fetching:** reject any URL whose scheme isn't `http`/`https`
   outright (no SSRF check needed for `file:`/`javascript:`/etc. — they're
   simply invalid). For `http`/`https`, parse the hostname and call the existing
   `resolvesToDisallowedAddress(hostname)` from
   `packages/agent-core/src/connectors/ssrf-guard.ts` — the same function
   `registry.ts` already uses to gate custom MCP server URLs (private ranges,
   loopback, link-local/cloud-metadata, CGNAT). A disallowed address returns
   `{ error: "that URL cannot be fetched" }` without ever calling `fetch`.
2. **Redirect TOCTOU:** a URL can pass the DNS-safe check and still 302 to an
   internal address at fetch time. Rather than re-checking after every hop (more
   moving parts), the fetch uses `redirect: "manual"` and treats any 3xx
   response as a hard failure — no redirect is ever followed. This means some
   legitimate URLs (link shorteners, `www` canonicalization redirects) won't
   index; acceptable trade-off for v1, simplest safe behavior.

## Fetch bounds

- `AbortSignal.timeout(10_000)` — matches the existing image-fetch timeout in
  `gateway-runner.ts`.
- `Content-Length` header checked before buffering the body: reject over
  2,000,000 bytes without downloading if the server reports a larger size.
- After buffering (`response.arrayBuffer()`), check the actual byte length as a
  backstop for servers that don't send `Content-Length`: reject over 2,000,000
  bytes.
- `Content-Type` response header must start with `text/html` or `text/plain`
  (charset suffix ignored) — anything else (a PDF, an image,
  `application/octet-stream`) is rejected with a clear "unsupported content
  type" error before any extraction is attempted.

## Extraction

Reuses the exact regex approach already shipped in
`apps/backend/src/gateway/gateway-runner.ts`'s `parseDocument` for `text/html`:

```ts
raw
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim()
```

`text/plain` responses are used as-is (decoded, no stripping needed).

**Title:** extracted from `<title>...</title>` via
`/<title[^>]*>([^<]*)<\/title>/i` when present; falls back to the URL itself
when absent or for `text/plain` responses.

## Source/document keying — differs from `index_text`

- **Source:** one shared per-user `ragSources` row via the extracted
  `ensureSource(userId, { path: "indexed-urls", name: "Indexed URLs", sourceType: "url" })`
  — same hardened pattern as "Chat notes", different bucket.
  (`sourceType: "url"` matches the schema comment's anticipated values:
  `"upload" | "url" | "folder" | "manual"`.)
- **Document:** unlike `index_text`'s fresh-random-UUID-per-call (each paste is
  independent), `index_url`'s `externalId` is the **normalized URL itself**
  (trimmed, no fragment). Re-indexing the same URL should _update_ the existing
  document via `indexDocument()`'s built-in content-hash check — if the page
  hasn't changed, it returns `"unchanged"` with the existing `documentId`; if it
  changed, `indexDocument` deletes the old document and its chunks, then
  re-indexes. This is the opposite keying choice from `index_text` deliberately:
  a URL has a natural stable identity, a paste doesn't.

## Gating

Identical to `index_text`: `checkConsent(userId, "cloud_memory")` inside the
service function (denial → `{ error }`, before any fetch), and the same
Pro/Max/owner plan check at tool-construction time in `run.ts` (tool absent from
`extraTools` entirely for an Explore-plan user).

## Interface

New file: `packages/agent-core/src/index-url.ts`, mirroring `index-text.ts`'s
factory shape:

```ts
export type IndexUrlResult =
  | { ok: true; documentId: string; title: string }
  | { error: string }
export type IndexUrlFn = (url: string) => Promise<IndexUrlResult>

export function createIndexUrlTool(indexUrl: IndexUrlFn) {
  return tool({
    description:
      "Fetch a URL and index its readable content into the user's searchable cloud " +
      "archive so it can be found later by the deep_research tool. Use this when the " +
      "user shares a link and asks you to remember, save, or index it.",
    parameters: z.object({
      url: z.string().url().max(2000).describe("The URL to fetch and index"),
    }),
    execute: async ({ url }) => indexUrl(url),
  })
}
```

**Backend service**, new `apps/backend/src/services/rag/url-ingest.ts`:

- `fetchAndExtractUrl(url: string): Promise<{ title: string; text: string } | { error: string }>`
  — the SSRF check, fetch, bounds checks, and extraction. Degrades to
  `{ error }` on any failure (blocked address, timeout, non-2xx status, wrong
  content-type, oversized body) — never throws.
- `indexUrl(userId: string, url: string): Promise<IndexUrlResult>` — the
  consent-gated wrapper, same try/catch/never-throw shape as `indexManualText`:
  checks consent, calls `fetchAndExtractUrl`, calls `ensureSource` +
  `indexDocument` (with `externalId` = normalized URL, `mimeType: "text/html"`),
  returns `{ ok, documentId, title }` or `{ error }`.

**Wiring**, `run.ts`: same shape as `index_text` — constructed alongside it
(after the same plan-gate check, since it's the same `canUseRag` boolean), added
as `index_url:` in the conditionally-spread `extraTools`.

## Error handling

- `fetchAndExtractUrl` never throws — every failure path returns
  `{ error: string }` with a specific, distinct message per case so the model
  can tell the user why:
  - Non-`http`/`https` scheme: `"only http and https URLs can be indexed"`
  - SSRF-blocked hostname: `"that URL cannot be fetched"`
  - Redirect response (any 3xx):
    `"that URL redirects, which isn't supported yet"`
  - Timeout or network failure: `"failed to fetch that URL"`
  - Non-2xx response: `` `fetch failed with status ${response.status}` ``
  - Wrong content-type: `"only HTML and plain-text pages can be indexed"`
  - Oversized (`Content-Length` or actual body over 2MB):
    `"that page is too large to index"`
- `indexUrl` wraps the whole body (consent check through `indexDocument`) in
  try/catch, same as `indexManualText` — logs via `console.error` on any
  unexpected exception, returns `{ error: "failed to index" }`.

## Testing

- `packages/agent-core/src/index-url.test.ts`: mirrors `index-text.test.ts` —
  tool shape, callback invocation with the URL, `{ ok }`/`{ error }`
  passthrough.
- `apps/backend/src/services/rag/source-lookup.test.ts`: the extracted
  `ensureSource` — same test coverage `manual-source.test.ts` already has for
  `ensureManualSource` (create, reuse, soft-delete resurrection, race),
  generalized to arbitrary `path`/`name`/`sourceType` params.
- `apps/backend/src/services/rag/manual-source.test.ts`: updated to mock
  `./source-lookup.js` instead of duplicating the get-or-create test coverage —
  `ensureManualSource` becomes a thin pass-through test (calls `ensureSource`
  with the right fixed params).
- `apps/backend/src/services/rag/url-ingest.test.ts`: `fetchAndExtractUrl` with
  a mocked global `fetch` — SSRF block (mocked `resolvesToDisallowedAddress`
  returning true), redirect rejection (mocked 3xx response), timeout, non-2xx,
  wrong content-type, oversized `Content-Length`, oversized actual body,
  successful HTML extraction (title + stripped text), successful plain-text
  passthrough. `indexUrl` with a mocked `fetchAndExtractUrl` + `ensureSource` +
  `indexDocument` — consent denial, extraction failure passthrough, successful
  index with URL-derived `externalId`, re-indexing the same URL reuses the same
  `externalId` (proving update-not-duplicate semantics at the call-argument
  level, matching how sub-item 1 tested reuse).
- `apps/backend/src/agent/run.test.ts`: wiring test proving `index_url` is
  present for Pro-plan/absent for Explore-plan, same shape as the existing
  `index_text` wiring tests.

## Open questions / deliberately deferred

- Whether 2MB/10s are the right bounds long-term — conservative starting point,
  same framing as prior items' budget choices this session.
- No dedicated telemetry for how often URLs are indexed or rejected (same gap
  flagged and deferred for `delegate`/`deep_research`'s cap-hits).
