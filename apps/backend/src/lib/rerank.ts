// Reranking for hybrid RAG retrieval.
// - mmrRerank: cheap, embedding-based Maximal Marginal Relevance (no network). Always on.
// - llmRerank: optional listwise rerank, disabled until an OpenAI rerank path is configured,
//   with a strict timeout; returns null on failure so the caller falls back to MMR order.

export interface RerankCandidate {
  chunkId: string
  content: string
  embedding: number[]
}

function dot(a: number[], b: number[]): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!
  return s
}

function cosine(a: number[], b: number[]): number {
  const denom = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b))
  return denom ? dot(a, b) / denom : 0
}

// Parse a pgvector text literal "[0.1,0.2,...]" into number[].
export function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[]
  if (typeof value !== "string") return []
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "")
  if (!inner) return []
  return inner
    .split(",")
    .map((v) => Number.parseFloat(v))
    .filter((v) => Number.isFinite(v))
}

// Maximal Marginal Relevance: trade off query relevance against novelty vs already-picked chunks.
// Also drops near-duplicate chunks that pure distance ordering would surface together.
export function mmrRerank(
  queryEmbedding: number[],
  candidates: RerankCandidate[],
  k: number,
  lambda = 0.7,
): RerankCandidate[] {
  if (candidates.length <= 1 || queryEmbedding.length === 0) return candidates.slice(0, k)
  const relevance = new Map<string, number>()
  for (const c of candidates) {
    relevance.set(c.chunkId, c.embedding.length ? cosine(queryEmbedding, c.embedding) : 0)
  }

  const selected: RerankCandidate[] = []
  const remaining = [...candidates]
  while (selected.length < k && remaining.length) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!
      const rel = relevance.get(c.chunkId) ?? 0
      let maxSim = 0
      for (const s of selected) {
        if (!c.embedding.length || !s.embedding.length) continue
        maxSim = Math.max(maxSim, cosine(c.embedding, s.embedding))
      }
      const score = lambda * rel - (1 - lambda) * maxSim
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]!)
  }
  return selected
}

// Optional listwise LLM rerank. Disabled until production enables reranking.
export async function llmRerank(
  _query: string,
  candidates: RerankCandidate[],
  k: number,
): Promise<RerankCandidate[] | null> {
  if (candidates.length <= 1 || k <= 0) return candidates.slice(0, k)
  return null
}
