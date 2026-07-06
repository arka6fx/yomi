import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db, ragDocuments, ragChunks, ragEmbeddings } from "@yomi/db"
import { chunkText, embedText, DEFAULT_EMBEDDING_MODEL } from "./embeddings.js"

export interface IndexDocumentInput {
  userId: string
  sourceId: string
  externalId: string
  title: string
  mimeType: string
  text: string
  metadata?: Record<string, unknown>
}

export function contentHashFor(externalId: string, text: string): string {
  return createHash("sha256").update(`${externalId}\0${text}`).digest("hex")
}

const MAX_TEXT_CHARS = 120_000

// Mirrors the sanitation the manual push path applies in routes/rag.ts: strips
// CRs, redacts inline images and long base64 runs, collapses blank lines, and
// caps size so a huge Drive export can't produce unbounded chunks/embeddings.
// Applied before hashing so the unchanged-check sees the stored text.
function sanitizeText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[redacted base64]")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, MAX_TEXT_CHARS)
    .trim()
}

export async function indexDocument(
  input: IndexDocumentInput,
): Promise<{ status: "indexed" | "unchanged"; documentId: string | null }> {
  const text = sanitizeText(input.text)
  const contentHash = contentHashFor(input.externalId, text)

  const existing = await db
    .select({ id: ragDocuments.id, contentHash: ragDocuments.contentHash })
    .from(ragDocuments)
    .where(
      and(eq(ragDocuments.sourceId, input.sourceId), eq(ragDocuments.externalId, input.externalId)),
    )
    .limit(1)

  if (existing[0]?.contentHash === contentHash) {
    return { status: "unchanged", documentId: existing[0].id }
  }
  if (existing[0]) {
    // Content changed — drop the old document; chunks/embeddings cascade.
    await db.delete(ragDocuments).where(eq(ragDocuments.id, existing[0].id))
  }

  const [document] = await db
    .insert(ragDocuments)
    .values({
      userId: input.userId,
      sourceId: input.sourceId,
      title: input.title,
      mimeType: input.mimeType,
      contentHash,
      externalId: input.externalId,
      metadata: input.metadata ?? null,
    })
    .returning()

  if (!document) return { status: "indexed", documentId: null }

  const chunks = chunkText(text)
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const [createdChunk] = await db
      .insert(ragChunks)
      .values({
        userId: input.userId,
        documentId: document.id,
        chunkIndex,
        content: chunk,
        tokenCount: Math.ceil(chunk.length / 4),
        metadata: input.metadata ?? null,
      })
      .returning({ id: ragChunks.id })
    if (!createdChunk) continue
    const embedding = await embedText(chunk)
    await db
      .insert(ragEmbeddings)
      .values({
        userId: input.userId,
        chunkId: createdChunk.id,
        model: process.env["AI_CREDITS_EMBEDDING_MODEL"] ?? DEFAULT_EMBEDDING_MODEL,
        embedding,
      })
      .returning({ id: ragEmbeddings.id })
  }

  return { status: "indexed", documentId: document.id }
}

export async function deleteDocumentByExternalId(
  userId: string,
  sourceId: string,
  externalId: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: ragDocuments.id })
    .from(ragDocuments)
    .where(and(eq(ragDocuments.sourceId, sourceId), eq(ragDocuments.externalId, externalId)))
    .limit(1)
  if (!existing[0]) return false
  await db.delete(ragDocuments).where(eq(ragDocuments.id, existing[0].id))
  return true
}
