import { indexUploadedDocument } from "../services/rag/document-source.js"

export interface PendingDocument {
  title: string
  content: string
}

export type ConsumePendingDocumentFn = () => PendingDocument | null
export type RestorePendingDocumentFn = (document: PendingDocument) => void

// Resolves an index_document tool call against the turn's stashed upload (if any).
// The model never supplies document content — the backend already extracted it
// server-side; this is the seam between that stash and the actual indexer. On a
// failed index, the consumed entry is restored so a transient failure (e.g. a
// denied consent prompt) doesn't force the user to re-upload the file to retry.
export async function resolvePendingDocumentIndex(
  userId: string,
  title: string | undefined,
  consumePendingDocument: ConsumePendingDocumentFn | undefined,
  restorePendingDocument: RestorePendingDocumentFn | undefined,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  const pending = consumePendingDocument?.()
  if (!pending) {
    return { error: "No recently uploaded document found — ask the user to re-upload it." }
  }

  const result = await indexUploadedDocument(userId, title ?? pending.title, pending.content)
  if ("error" in result) {
    restorePendingDocument?.(pending)
  }
  return result
}
