export const MEMORY_EMBEDDING_DIMENSIONS = 1536
export const DEFAULT_MEMORY_EMBEDDING_MODEL = "text-embedding-3-small"

export function memoryEmbeddingModel(): string {
  return process.env["OPENAI_EMBEDDING_MODEL"] ?? DEFAULT_MEMORY_EMBEDDING_MODEL
}

// Best-effort: every failure degrades to [] so recall falls back to full-text/metadata ranking.
export async function embedMemoryText(input: string): Promise<number[]> {
  if (!input.trim()) return []
  const apiKey = process.env["OPENAI_API_KEY"]
  if (!apiKey) return []
  const baseUrl = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  )
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: memoryEmbeddingModel(), input }),
  })
  if (!res.ok) return []
  const body = (await res.json()) as { data?: { embedding?: number[] }[] }
  const embedding = body.data?.[0]?.embedding
  return Array.isArray(embedding) && embedding.length === MEMORY_EMBEDDING_DIMENSIONS
    ? embedding
    : []
}

export function memoryVectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toFixed(8) : "0")).join(",")}]`
}
