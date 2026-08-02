import { sql } from "drizzle-orm"
import { db } from "@yomi/db"
import { embedMemoryText, memoryVectorLiteral } from "./embeddings.js"

// The ~20 nearest active memories to the full turn, shown to the extraction call so it can
// name what a correction replaces by id instead of guessing a topic string (ADR 0006).
export const TURN_CANDIDATE_LIMIT = 20
const CANDIDATE_CONTENT_CHARS = 240

export type TurnCandidate = {
  id: string
  kind: string
  topic: string
  summary: string | null
  content: string
}

export function turnTextFor(input: string, output: string): string {
  return `User: ${input}\nAssistant: ${output}`
}

// Best-effort by design: every failure yields an empty candidate set, so the turn's memories
// are still stored — just without a supersession — rather than lost.
export async function fetchTurnCandidates(userId: string, turn: string): Promise<TurnCandidate[]> {
  if (!turn.trim()) return []
  const embedding = await embedMemoryText(turn).catch(() => [])
  if (!embedding.length) return []
  const vector = memoryVectorLiteral(embedding)

  try {
    const result = await db.execute(sql`
      select e.id as "id",
             e.kind as "kind",
             e.topic as "topic",
             e.summary as "summary",
             e.content as "content"
      from memory_embeddings me
      join memory_entries e on e.id = me.memory_id
      where me.user_id = ${userId}
        and e.status = 'active'
        and e.is_latest = true
      order by me.embedding <=> ${vector}::vector
      limit ${TURN_CANDIDATE_LIMIT}
    `)
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as TurnCandidate[]
    return rows
      .filter((row) => row && typeof row.id === "string")
      .map((row) => ({
        id: row.id,
        kind: String(row.kind ?? "fact"),
        topic: String(row.topic ?? ""),
        summary: row.summary ?? null,
        content: String(row.content ?? ""),
      }))
  } catch {
    return []
  }
}

export function renderTurnCandidates(candidates: TurnCandidate[]): string {
  if (!candidates.length) return "(none stored yet)"
  return candidates
    .map((candidate) => {
      const body = (candidate.summary || candidate.content).slice(0, CANDIDATE_CONTENT_CHARS)
      return `- id=${candidate.id} [${candidate.kind}] ${candidate.topic}: ${body}`
    })
    .join("\n")
}

// Kept in sync with the "Memory contradiction" section of CONTEXT.md — if the definitions
// drift, the model starts superseding elaborations.
const CONTRADICTION_RULES = `- contradiction: the new memory is incompatible with a listed one about the same subject ("uses vim" -> "switched to VS Code"). Set replaces_id to that memory's id.
- duplicate: the same claim, only reworded ("uses vim" -> "is a vim user"). Leave replaces_id out.
- elaboration: compatible with a listed one and adds detail ("uses vim" -> "uses vim with a custom leader key"). Leave replaces_id out.

Test a pairing by asking whether both statements can be true of the user at the same time. "Uses vim" and "uses vim with a custom leader key" can both be true, so that is an elaboration and replaces_id stays out. "Uses vim" and "is a vim user" say the same thing in different words, so that is a duplicate and replaces_id stays out. "Uses vim" and "switched to VS Code" cannot both be true, so that is a contradiction. Same subject, more detail, or more recent wording is never enough on its own — only the listed memory being wrong now. A restatement of a listed memory is a duplicate however much better it is worded, and duplicates are stored alongside, so replaces_id stays out. Before emitting replaces_id, say to yourself what the listed memory claims and what became false about it; if nothing did, omit replaces_id.`

export function buildExtractionPrompt(
  input: string,
  output: string,
  candidates: TurnCandidate[],
): string {
  return `Extract durable user memory from this Yomi backend-agent interaction.

Return strict JSON only:
{"memories":[{"kind":"preference|fact|project|decision|open_thread|correction","scope":"global|project|app|session","topic":"short key","content":"one concise memory","confidence":0.0,"replaces_id":"omit unless this turn makes a listed memory false"}]}

Rules:
- Store only useful future context.
- Do not store secrets, passwords, API keys, or one-off trivia.
- Prefer high precision. If uncertain, omit it.

Memories already stored for this user:
${renderTurnCandidates(candidates)}

replaces_id retires a listed memory: the one it names stops being part of what you know about this user. Set it only for a contradiction, and only to an id exactly as listed above:
${CONTRADICTION_RULES}

${turnTextFor(input, output)}`
}

export type ExtractedMemory = {
  kind?: string
  scope?: string
  topic?: string
  content?: string
  confidence?: number
  replaces_id?: unknown
}

export function parseExtractedMemories(text: string): ExtractedMemory[] {
  try {
    const parsed = JSON.parse(text) as { memories?: ExtractedMemory[] }
    return Array.isArray(parsed.memories) ? parsed.memories : []
  } catch {
    return []
  }
}

// A supersession destroys a live memory, so only an id the model was actually shown is acted on.
export function pickReplacesId(value: unknown, candidates: TurnCandidate[]): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const id = value.trim()
  return candidates.some((candidate) => candidate.id === id) ? id : undefined
}
