import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"
import { ensureSource } from "./source-lookup.js"

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

// Idempotent get-or-create: every index_document call for a user reuses the same
// "Uploaded documents" source rather than creating a new one each time.
export async function ensureDocumentSource(userId: string): Promise<string> {
  return ensureSource(userId, {
    path: DOCUMENT_SOURCE_PATH,
    name: DOCUMENT_SOURCE_NAME,
    sourceType: DOCUMENT_SOURCE_TYPE,
  })
}

// Consent-gated wrapper around indexDocument() for agent-triggered document uploads.
// Never throws — a thrown error from checkConsent, ensureDocumentSource, or
// indexDocument would otherwise propagate out of the index_document tool's execute
// and kill the whole parent turn (same class of bug already fixed for
// delegate/deep_research/index_text/index_url), so the whole body — including the
// consent check — is guarded.
export async function indexUploadedDocument(
  userId: string,
  title: string,
  content: string,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  try {
    const consent = await checkConsent(userId, "cloud_memory")
    if (!consent.allowed) {
      return {
        error: `cloud memory consent not granted${consent.reason ? `: ${consent.reason}` : ""}`,
      }
    }

    const sourceId = await ensureDocumentSource(userId)
    const result = await indexDocument({
      userId,
      sourceId,
      externalId: crypto.randomUUID(),
      title: cleanTitle(title, 200),
      mimeType: "text/plain",
      text: content,
    })
    if (!result.documentId) return { error: "failed to index" }
    return { ok: true, documentId: result.documentId }
  } catch (err) {
    console.error(
      "[indexUploadedDocument] failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return { error: "failed to index" }
  }
}
