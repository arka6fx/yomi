import { chunkMarkdown } from "@yomi/shared"

export const EMBEDDING_DIMENSIONS = 1536
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
const CHUNK_CHARS = 1800
const CHUNK_OVERLAP = 220

export function chunkText(content: string): string[] {
  return chunkMarkdown(content, { targetChars: CHUNK_CHARS, overlap: CHUNK_OVERLAP })
}

export async function embedText(input: string): Promise<number[]> {
  if (!input.trim()) return []
  const apiKey = process.env["OPENAI_API_KEY"]
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for Cloud RAG embeddings")
  const baseUrl = (process.env["OPENAI_BASE_URL"] ?? "https://api.aicredits.in/v1").replace(
    /\/+$/,
    "",
  )
  const model = process.env["OPENAI_EMBEDDING_MODEL"] ?? DEFAULT_EMBEDDING_MODEL
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  })
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status}`)
  const body = (await res.json()) as { data?: { embedding?: number[] }[] }
  const embedding = body.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`OpenAI embedding dimensions must be ${EMBEDDING_DIMENSIONS}`)
  }
  return embedding
}
