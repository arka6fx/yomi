import { describe, expect, it, mock, beforeEach } from "bun:test"

const rows: { documents: any[]; chunks: any[]; embeddings: any[] } = {
  documents: [],
  chunks: [],
  embeddings: [],
}

let existingDocRows: any[] = []

mock.module("@yomi/db", () => {
  const makeChain = (bucket: string) => ({
    values: (v: any) => ({
      returning: (sel?: any) => {
        const id = `${bucket}-${rows[bucket as keyof typeof rows].length}`
        rows[bucket as keyof typeof rows].push({ id, ...v })
        return Promise.resolve([{ id, ...v }])
      },
    }),
  })
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(existingDocRows) }) }) }),
    insert: (table: any) => makeChain(table.__name),
    delete: () => ({ where: () => Promise.resolve() }),
  }
  return {
    db,
    ragDocuments: { __name: "documents" },
    ragChunks: { __name: "chunks" },
    ragEmbeddings: { __name: "embeddings" },
  }
})

mock.module("./embeddings.js", () => ({
  embedText: async () => new Array(1536).fill(0.1),
  chunkText: (t: string) => [t],
  EMBEDDING_DIMENSIONS: 1536,
  DEFAULT_EMBEDDING_MODEL: "text-embedding-3-small",
}))

const { indexDocument, contentHashFor } = await import("./index-document.js")

beforeEach(() => {
  rows.documents = []
  rows.chunks = []
  rows.embeddings = []
  existingDocRows = []
})

describe("indexDocument", () => {
  it("indexes a new document with chunks and embeddings", async () => {
    const res = await indexDocument({
      userId: "u1",
      sourceId: "s1",
      externalId: "file-1",
      title: "Notes",
      mimeType: "text/plain",
      text: "hello world",
    })
    expect(res.status).toBe("indexed")
    expect(rows.documents.length).toBe(1)
    expect(rows.chunks.length).toBe(1)
    expect(rows.embeddings.length).toBe(1)
    expect(rows.documents[0].externalId).toBe("file-1")
  })

  it("contentHashFor is stable for same input and differs on change", () => {
    const a = contentHashFor("file-1", "hello")
    const b = contentHashFor("file-1", "hello")
    const c = contentHashFor("file-1", "hello!")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it("returns unchanged when document content hash matches existing", async () => {
    const content = "hello world"
    const hash = contentHashFor("file-1", content)
    existingDocRows = [{ id: "doc-existing", contentHash: hash }]

    const res = await indexDocument({
      userId: "u1",
      sourceId: "s1",
      externalId: "file-1",
      title: "Notes",
      mimeType: "text/plain",
      text: content,
    })

    expect(res.status).toBe("unchanged")
    expect(res.documentId).toBe("doc-existing")
    expect(rows.documents.length).toBe(0)
    expect(rows.chunks.length).toBe(0)
    expect(rows.embeddings.length).toBe(0)
  })
})
