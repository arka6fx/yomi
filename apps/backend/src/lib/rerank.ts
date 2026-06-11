// Reranking for hybrid RAG retrieval.
// - mmrRerank: cheap, embedding-based Maximal Marginal Relevance (no network). Always on.
// - llmRerank: optional listwise rerank via the OpenAI-compatible chat endpoint (RAG_RERANK_LLM=true),
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

// Optional listwise LLM rerank. Returns reranked candidates, or null on timeout/failure.
export async function llmRerank(
  query: string,
  candidates: RerankCandidate[],
  k: number,
): Promise<RerankCandidate[] | null> {
  const apiKey = process.env["OPENAI_API_KEY"]
  if (!apiKey || candidates.length <= 1) return null
  // was: process.env["RAG_RERANK_MODEL"] ?? "gpt-4.1-mini"
  const model = process.env["RAG_RERANK_MODEL"] ?? "minimax.minimax-m2.5"
  const base = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/$/, "")
  const timeoutMs = Math.max(
    200,
    Number.parseInt(process.env["RAG_RERANK_TIMEOUT_MS"] ?? "800", 10) || 800,
  )

  const list = candidates
    .map((c, i) => `[${i + 1}] ${c.content.slice(0, 500).replace(/\s+/g, " ")}`)
    .join("\n")
  const prompt = `Rank the passages by how well they help answer the query. Return ONLY a JSON array of passage numbers, most relevant first, no prose.\n\nQuery: ${query}\n\nPassages:\n${list}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content ?? ""
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return null
    const order = JSON.parse(match[0]) as number[]
    const seen = new Set<number>()
    const ranked: RerankCandidate[] = []
    for (const n of order) {
      const idx = n - 1
      if (idx >= 0 && idx < candidates.length && !seen.has(idx)) {
        seen.add(idx)
        ranked.push(candidates[idx]!)
      }
    }
    // Append anything the model omitted, preserving the input (RRF) order.
    candidates.forEach((c, i) => {
      if (!seen.has(i)) ranked.push(c)
    })
    return ranked.slice(0, k)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
