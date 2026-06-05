import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"

// Knowledge Base (the spec's "Learn / Remember / Improve" layer). Persists what worked so future
// runs consult prior experience before executing and reuse recoveries that previously succeeded.
// Mirrors automation/runs.ts: lazy SQLite at ~/.yomi/knowledge.db with an in-memory fallback.

// Resolved lazily (not at module load) so tests can point it at :memory: before the first open.
function resolveDbPath(): string {
  return process.env.YOMI_KNOWLEDGE_DB || join(homedir(), ".yomi", "knowledge.db")
}

let db: Database | null = null
let seq = 0

export interface WorkflowRecord {
  id: string
  agentId: string
  goal: string
  goalKey: string
  tools: string[]
  stepCount: number
  recoveryCount: number
  durationMs: number
  outcome: "success" | "failure"
  summary: string
  createdAt: string
}

export interface RecoveryRecord {
  id: string
  agentId: string
  goalKey: string
  error: string
  strategy: string
  createdAt: string
}

export interface KnowledgeRecall {
  workflows: WorkflowRecord[]
  recoveries: RecoveryRecord[]
}

function getDb(): Database {
  if (db) return db
  const dbPath = resolveDbPath()
  if (dbPath !== ":memory:") mkdirSync(join(homedir(), ".yomi"), { recursive: true })
  try {
    db = new Database(dbPath)
  } catch (err) {
    console.warn("[yomi/knowledge] local db unavailable, using in-memory:", err)
    db = new Database(":memory:")
  }
  db.exec(`
    create table if not exists workflows (
      id text primary key,
      agent_id text not null,
      goal text not null,
      goal_key text not null,
      tools_json text not null default '[]',
      step_count integer not null default 0,
      recovery_count integer not null default 0,
      duration_ms integer not null default 0,
      outcome text not null,
      summary text not null default '',
      created_at text not null
    );
    create index if not exists workflows_agent on workflows(agent_id);
    create table if not exists recoveries (
      id text primary key,
      agent_id text not null,
      goal_key text not null,
      error text not null,
      strategy text not null,
      created_at text not null
    );
    create index if not exists recoveries_agent on recoveries(agent_id);
  `)
  return db
}

// Normalize a goal to a comparable token string (lowercase, alnum words only).
export function goalKeyOf(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function salientTokens(key: string): Set<string> {
  return new Set(key.split(" ").filter((w) => w.length > 2))
}

function overlap(tokens: Set<string>, key: string): number {
  let n = 0
  for (const w of key.split(" ")) if (tokens.has(w)) n++
  return n
}

export function recordWorkflow(rec: Omit<WorkflowRecord, "id" | "createdAt">): void {
  try {
    const id = `wf-${Date.now()}-${++seq}`
    getDb()
      .query(
        `insert into workflows
         (id, agent_id, goal, goal_key, tools_json, step_count, recovery_count, duration_ms, outcome, summary, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        rec.agentId,
        rec.goal,
        rec.goalKey,
        JSON.stringify(rec.tools),
        rec.stepCount,
        rec.recoveryCount,
        rec.durationMs,
        rec.outcome,
        rec.summary,
        new Date().toISOString(),
      )
  } catch (err) {
    console.warn("[yomi/knowledge] recordWorkflow failed:", err)
  }
}

export function recordRecovery(rec: Omit<RecoveryRecord, "id" | "createdAt">): void {
  if (!rec.strategy.trim()) return
  try {
    const id = `rec-${Date.now()}-${++seq}`
    getDb()
      .query(
        `insert into recoveries (id, agent_id, goal_key, error, strategy, created_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, rec.agentId, rec.goalKey, rec.error, rec.strategy, new Date().toISOString())
  } catch (err) {
    console.warn("[yomi/knowledge] recordRecovery failed:", err)
  }
}

interface WorkflowRow {
  id: string
  agent_id: string
  goal: string
  goal_key: string
  tools_json: string
  step_count: number
  recovery_count: number
  duration_ms: number
  outcome: string
  summary: string
  created_at: string
}
interface RecoveryRow {
  id: string
  agent_id: string
  goal_key: string
  error: string
  strategy: string
  created_at: string
}

// Retrieve a small, relevance-ranked slice of prior experience for an agent + goal. Bounded by
// design (recent rows ranked by token overlap) so it stays well under the 200ms retrieval budget.
export function recallKnowledge(agentId: string, goal: string, limit = 3): KnowledgeRecall {
  try {
    const tokens = salientTokens(goalKeyOf(goal))
    const wfRows = getDb()
      .query(
        `select * from workflows where agent_id = ? and outcome = 'success'
         order by created_at desc limit 25`,
      )
      .all(agentId) as WorkflowRow[]
    const workflows = wfRows
      .map((r) => ({ r, score: overlap(tokens, r.goal_key) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ r }) => ({
        id: r.id,
        agentId: r.agent_id,
        goal: r.goal,
        goalKey: r.goal_key,
        tools: safeTools(r.tools_json),
        stepCount: r.step_count,
        recoveryCount: r.recovery_count,
        durationMs: r.duration_ms,
        outcome: r.outcome as "success" | "failure",
        summary: r.summary,
        createdAt: r.created_at,
      }))

    const recRows = getDb()
      .query(`select * from recoveries where agent_id = ? order by created_at desc limit 25`)
      .all(agentId) as RecoveryRow[]
    const recoveries = recRows
      .map((r) => ({ r, score: overlap(tokens, r.goal_key) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ r }) => ({
        id: r.id,
        agentId: r.agent_id,
        goalKey: r.goal_key,
        error: r.error,
        strategy: r.strategy,
        createdAt: r.created_at,
      }))

    return { workflows, recoveries }
  } catch (err) {
    console.warn("[yomi/knowledge] recallKnowledge failed:", err)
    return { workflows: [], recoveries: [] }
  }
}

function safeTools(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : []
  } catch {
    return []
  }
}

// Render a bounded prompt block from recalled knowledge, or null when there is nothing useful.
export function knowledgeHint(recall: KnowledgeRecall): string | null {
  const lines: string[] = []
  if (recall.workflows.length) {
    const w = recall.workflows[0]!
    const tools = w.tools.length ? w.tools.slice(0, 6).join(", ") : "no tools"
    lines.push(`Prior success on a similar task used: ${tools} (${w.stepCount} steps).`)
  }
  for (const r of recall.recoveries.slice(0, 2)) {
    lines.push(`Known fix — when "${r.error}": ${r.strategy}`)
  }
  if (!lines.length) return null
  return `Prior experience (consult before acting):\n${lines.join("\n")}`
}

// Test hook: drop the connection so the next call reopens (picks up a fresh :memory: db).
export function __resetKnowledgeForTest(): void {
  try {
    db?.close()
  } catch {
    /* already closed */
  }
  db = null
  seq = 0
}
