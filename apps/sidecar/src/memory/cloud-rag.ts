import type { CloudRagSnippet } from "@yomi/shared"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001"

export async function retrieveCloudRagContext(opts: {
  query: string
  enabled?: boolean
  authToken?: string
  maxChars?: number
}): Promise<string> {
  if (!opts.enabled || !opts.authToken || !opts.query.trim()) return ""

  try {
    const res = await fetch(`${BACKEND_URL}/api/rag/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.authToken}`,
      },
      body: JSON.stringify({
        query: opts.query,
        limit: 5,
        maxChars: opts.maxChars ?? 3000,
      }),
    })
    if (!res.ok) return ""
    const data = await res.json() as { snippets?: CloudRagSnippet[] }
    const snippets = data.snippets ?? []
    let used = 0
    const out: string[] = []
    for (const item of snippets) {
      const line = `- ${item.title}: ${item.content}`
      if (used + line.length > (opts.maxChars ?? 3000)) break
      out.push(line)
      used += line.length
    }
    return out.join("\n")
  } catch (err) {
    console.warn("[yomi/rag] cloud retrieval failed:", err instanceof Error ? err.message : err)
    return ""
  }
}
