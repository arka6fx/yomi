# RAG ingestion beyond Drive — sub-item 3: documents (`index_document`) — design

Status: approved
Date: 2026-08-03
Backlog ref: `docs/agentic-backlog.md` item 10

## Problem

Sub-items 1 (`index_text`, merged) and 2 (`index_url`, merged) let the agent
index arbitrary pasted text and fetched URLs. The backlog item's original
scope also names PDFs. There's no way for a user to upload a PDF or Word
document via Telegram and have its content persisted into the same
`rag_documents`/`rag_chunks` pipeline `deep_research` and passive injection
already read from.

## What already exists

`apps/backend/src/gateway/gateway-runner.ts` already handles Telegram
document uploads end to end, for a different purpose (one-turn context, not
persistence):

- On `msg.documentUrl`, it downloads the file and calls `parseDocument()`.
- `parseDocument()` dispatches on MIME type / extension. Plain text and HTML
  are extracted server-side. PDF and Word (`.docx`/`.doc`) go through
  `services/document-extract.ts`'s `extractTextViaDrive()`: the file is
  uploaded through the user's own Google Drive as a temporary Google Doc
  (Drive OCRs PDFs on import), exported as plain text, then the temp file is
  deleted. Returns `null` if the user has no Drive connection, the upload/
  export fails, or the extracted text is empty/whitespace-only (e.g. a
  scanned image Drive couldn't OCR). Output is truncated to 50,000 chars.
- The extracted text (if any) is prepended to that turn's message as
  `[Document: name]\n{text}\n---\n{original caption}` (or just
  `[Document: name]\n{text}` with no caption) before the agent ever runs.
  On extraction failure, a fallback note (`📄 File: name`) is used instead —
  no text, just an acknowledgement that a file arrived.

This means the one genuinely hard part of "index a PDF" — turning binary PDF
bytes into text, including OCR for scanned pages — is already built,
already working, and already runs automatically on every document upload.
This sub-item's job is narrower than sub-items 1 and 2: give the agent a way
to persist text it already has in its context, once the user asks it to.

## Goal

An `index_document` tool the backend agent can call to persist an uploaded
document's already-extracted text into the user's cloud RAG archive — same
consent/plan gating as `index_text`/`index_url`, its own source bucket
("Uploaded documents") so uploaded-file content stays organizationally
distinct from pasted notes and saved URLs.

## Non-goals

- Any new extraction/OCR/fetch logic. `gateway-runner.ts`'s existing
  `parseDocument`/`extractTextViaDrive` pipeline is reused entirely as-is,
  unmodified.
- Handling extraction failure inside this tool. By the time `index_document`
  could be called, extraction has already succeeded or failed upstream — a
  failure means the agent has no document text in its context at all (just
  the `📄 File: name` fallback note), so it has nothing to pass to this
  tool. No new error path is needed for "Drive not connected" or "OCR
  failed"; those already degrade gracefully today, independent of this
  feature.
- File types beyond what `parseDocument` already extracts as PDF/Word (i.e.
  no new format support). Plain text/HTML uploads already get indexed today
  via the existing `index_text` tool once their content is in the agent's
  context, since nothing distinguishes "pasted text" from "extracted text
  from a .txt upload" at that point — this sub-item only adds a distinct
  path for the two types (PDF, Word) that `parseDocument` treats specially.

## Interface

New file: `packages/agent-core/src/index-document.ts`, mirroring
`index-text.ts`'s factory shape exactly:

```ts
export type IndexDocumentResult = { ok: true; documentId: string } | { error: string }
export type IndexDocumentFn = (title: string, content: string) => Promise<IndexDocumentResult>

export function createIndexDocumentTool(indexDocument: IndexDocumentFn) {
  return tool({
    description:
      "Index an uploaded document's content into the user's searchable cloud archive " +
      "so it can be found later by the deep_research tool. Use this when the user has " +
      "uploaded a PDF or Word document (its content will appear in your context as " +
      "'[Document: ...]') and asks you to remember, save, or index it.",
    parameters: z.object({
      title: z.string().min(1).max(200).describe("A short, descriptive title — typically the document's filename"),
      content: z.string().min(1).max(100_000).describe("The document's extracted text content"),
    }),
    execute: async ({ title, content }) => indexDocument(title, content),
  })
}
```

## Source/document keying

- **Source:** one shared per-user `ragSources` row via the existing
  `ensureSource(userId, { path: "uploaded-documents", name: "Uploaded documents", sourceType: "document" })`
  — same hardened pattern already shared by `index_text` ("Chat notes") and
  `index_url` ("Indexed URLs"), different bucket. The `rag_sources.sourceType`
  column's type-hint comment in `packages/db/src/schema.ts` currently reads
  `"upload" | "url" | "folder" | "manual"` — it does not yet list
  `"document"`. Same as when sub-item 2 added `"url"` to that comment,
  `"document"` is a new value being introduced here; the implementation plan
  should update the comment to
  `"upload" | "url" | "folder" | "manual" | "document"` alongside adding
  `document-source.ts`.
- **Document:** like `index_text` (and unlike `index_url`), `externalId` is
  a fresh random UUID per call — an uploaded document has no natural stable
  identity the way a URL does (the same file re-uploaded isn't obviously
  "the same document" without content hashing, which `indexDocument()`
  already does internally for genuine duplicate detection).

## Title handling

The filename-derived title is third-party-influenced (a user could name a
file anything, or forward a file whose name they didn't choose), and the
final review of sub-item 2 found that an unsanitized title can break the
single-line RAG-context header format used by passive injection, or — if
long enough — silently suppress a turn's entire RAG context. Applying that
fix proactively here rather than waiting for review to rediscover it:
before indexing, the title is run through the same `cleanTitle`-style
sanitization already used by `index_text`'s `manual-source.ts` (strip
`\r`, collapse 3+ consecutive newlines to 2, slice to 200 chars, trim).

## Gating

Identical to `index_text`/`index_url`: `checkConsent(userId, "cloud_memory")`
inside the service function (denial → `{ error }`), and the same Pro/Max/
owner plan check at tool-construction time in `run.ts` (tool absent from
`extraTools` entirely for an Explore-plan user, not present-and-erroring).

## Backend service

New file: `apps/backend/src/services/rag/document-source.ts`, mirroring
`manual-source.ts`'s shape:

```ts
export const DOCUMENT_SOURCE_TYPE = "document"
const DOCUMENT_SOURCE_NAME = "Uploaded documents"
const DOCUMENT_SOURCE_PATH = "uploaded-documents"

function cleanTitle(value: string, max: number): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

export async function ensureDocumentSource(userId: string): Promise<string> {
  return ensureSource(userId, {
    path: DOCUMENT_SOURCE_PATH,
    name: DOCUMENT_SOURCE_NAME,
    sourceType: DOCUMENT_SOURCE_TYPE,
  })
}

export async function indexUploadedDocument(
  userId: string,
  title: string,
  content: string,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  // same consent-check → ensureDocumentSource → indexDocument() → never-throws
  // shape as indexManualText, with cleanTitle applied to `title` before indexing.
}
```

## Wiring

`run.ts`: same shape as `index_text`/`index_url` — constructed alongside
them (same `canUseRag` boolean, no new gate logic), added as
`index_document:` in the conditionally-spread `extraTools`.

## Error handling

- `indexUploadedDocument` never throws — same try/catch/degrade-to-`{error}`
  shape as `indexManualText`/`indexUrl`. There is no new set of distinct
  error strings to design (unlike `index_url`'s 7 fetch-related cases): the
  only failure paths are consent denial and an unexpected exception from
  `ensureDocumentSource`/`indexDocument`, both already-established patterns.

## Testing

- `packages/agent-core/src/index-document.test.ts`: mirrors
  `index-text.test.ts` exactly — tool shape, callback invocation with
  title/content, `{ ok }`/`{ error }` passthrough.
- `apps/backend/src/services/rag/document-source.test.ts`: mirrors
  `manual-source.test.ts`'s `indexManualText` coverage — consent denial,
  successful index with a fresh `externalId` per call, distinct
  `externalId` across repeated calls, error when `indexDocument` returns no
  `documentId`, never-throws on `checkConsent`/`indexDocument` exceptions.
  Also: a test confirming the title is sanitized (e.g. a title containing
  `\r\n\n\n\n` collapses per `cleanTitle`'s rules) before being passed to
  `indexDocument()`.
- `apps/backend/src/agent/run.test.ts`: wiring test proving `index_document`
  is present for Pro-plan/absent for Explore-plan, same shape as the
  existing `index_text`/`index_url` wiring tests.

## Open questions / deliberately deferred

- Plain-text/HTML uploads (`.txt`, `.md`, `.csv`, `.json`, `.xml`, `.html`)
  already get extracted by `parseDocument` today but have no distinct
  indexing path — they'd currently need to go through `index_text` (with
  the agent inferring a title from the filename), landing in "Chat notes"
  rather than a document-specific bucket. Not addressed here; revisit if it
  becomes a common enough pattern to warrant its own bucket, or if
  `index_document`'s scope should widen to match everything
  `parseDocument` extracts rather than just PDF/Word.
- No dedicated telemetry for how often documents are indexed via this path
  (same gap already flagged and deferred for `index_text`/`index_url`).
- The pre-existing soft-delete-resurrection issue (tracked as GitHub issue
  #100) applies equally to this bucket once it exists — no new exposure
  introduced here, just inherited from the shared `ensureSource` helper.
