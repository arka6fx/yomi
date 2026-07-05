// Memory graph traversal for retrieval.
// Uses the existing memory_relations (updates/extends/derives) to walk the
// knowledge graph and surface related memories. Inspired by Supermemory's
// memory graph and OpenClaw's concept vocabulary.

type MemoryNode = {
  id: string
  kind: string
  scope: string
  topic: string
  content: string
  confidence: number
  isStatic: boolean
  updatedAt: string
  relations?: MemoryRelation[]
}

type MemoryRelation = {
  targetId: string
  relationType: "updates" | "extends" | "derives"
  targetTopic: string
  targetKind: string
}

type GraphWalkResult = {
  root: MemoryNode
  chain: MemoryNode[]
  branched: MemoryNode[]
  strength: number
}

// Fetch related memories from the cloud backend by walking the relation graph.
export async function walkMemoryGraph(
  rootId: string,
  maxDepth = 3,
  maxNodes = 16,
): Promise<GraphWalkResult | null> {
  const token = process.env["YOMI_SESSION_TOKEN"]
  if (!token) return null

  const baseUrl =
    process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"

  try {
    const res = await fetch(`${baseUrl}/api/memory/graph-walk`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rootId, maxDepth, maxNodes }),
    })
    if (!res.ok) return null
    return (await res.json()) as GraphWalkResult
  } catch {
    return null
  }
}

// Build a context trail from a set of memories by chaining their relations.
export function buildContextTrail(nodes: MemoryNode[], query: string, maxChars: number): string {
  if (!nodes.length) return ""

  const lines: string[] = []
  let used = 0

  for (const node of nodes) {
    const line = `[${node.kind}] ${node.topic}: ${node.content.slice(0, 200)}`
    if (used + line.length > maxChars) break

    if (node.relations?.length) {
      const related = node.relations
        .slice(0, 3)
        .map((r) => `${r.relationType} → ${r.targetTopic}`)
        .join(", ")
      lines.push(`${line} (${related})`)
      used += line.length + related.length + 3
    } else {
      lines.push(line)
      used += line.length
    }
  }

  return lines.join("\n")
}

// Score a memory node by its graph connectivity (PageRank-like).
export function scoreByConnectivity(nodes: MemoryNode[]): Map<string, number> {
  const scores = new Map<string, number>()
  const outgoing = new Map<string, number>()
  const incoming = new Map<string, number>()

  for (const node of nodes) {
    if (!node.relations) continue
    for (const rel of node.relations) {
      outgoing.set(node.id, (outgoing.get(node.id) ?? 0) + 1)
      incoming.set(rel.targetId, (incoming.get(rel.targetId) ?? 0) + 1)
    }
  }

  for (const node of nodes) {
    const out = outgoing.get(node.id) ?? 0
    const inc = incoming.get(node.id) ?? 0
    const connectivity = 0.4 * Math.log1p(out) + 0.6 * Math.log1p(inc)
    scores.set(node.id, connectivity)
  }

  return scores
}

// Find version chain for a memory (root -> updates chain).
export function buildVersionChain(nodes: MemoryNode[], startId: string): MemoryNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const chain: MemoryNode[] = []
  let current = nodeMap.get(startId)
  const visited = new Set<string>()

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    chain.push(current)
    const updatesRel = current.relations?.find((r) => r.relationType === "updates")
    current = updatesRel ? nodeMap.get(updatesRel.targetId) : undefined
  }

  return chain
}
