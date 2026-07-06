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

export async function indexDocument(
  input: IndexDocumentInput,
): Promise<{ status: "indexed" | "unchanged"; documentId: string | null }> {
  const contentHash = contentHashFor(input.externalId, input.text)

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

  const chunks = chunkText(input.text)
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
