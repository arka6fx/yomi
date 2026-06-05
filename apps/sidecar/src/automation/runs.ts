import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import type {
  AutomationOwner,
  AutomationPreview,
  AutomationRisk,
  AutomationRun,
  AutomationState,
  AutomationTimelineItem,
  SseEvent,
} from "@yomi/shared"

let db: Database | null = null
let runSeq = 0
let itemSeq = 0
let warnedMemoryFallback = false

function resolveDbPath(): string {
  return process.env.YOMI_AUTOMATION_DB || join(homedir(), ".yomi", "automation.db")
}

export interface AutomationSession {
  run: AutomationRun
  events: SseEvent[]
}

function getDb(): Database {
  if (db) return db
  const dbPath = resolveDbPath()
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true })
  try {
    db = new Database(dbPath)
  } catch (err) {
    console.warn("[yomi/automation] local db unavailable, using in-memory runs:", err)
    db = new Database(":memory:")
  }
  initSchema(db)
  return db
}

function initSchema(target: Database): void {
  target.exec(`
    create table if not exists automation_runs (
      id text primary key,
      replay_id text unique,
      task text not null,
      owner_id text not null,
      owner_label text not null,
      status text not null,
      started_at text not null,
      ended_at text,
      summary text,
      command text not null,
      timeline_json text not null default '[]'
    );
  `)
}

function isReadOnlyDbError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    ("code" in err || "message" in err) &&
    ((err as { code?: unknown }).code === "SQLITE_READONLY" ||
      String((err as { message?: unknown }).message ?? "").includes("readonly database"))
  )
}

function fallbackToMemoryDb(err: unknown): Database {
  try {
    db?.close()
  } catch {
    /* best effort */
  }
  if (!warnedMemoryFallback) {
    console.warn("[yomi/automation] local db is read-only, using in-memory runs:", err)
    warnedMemoryFallback = true
  }
  db = new Database(":memory:")
  initSchema(db)
  return db
}

function runWrite(write: (target: Database) => void): void {
  try {
    write(getDb())
  } catch (err) {
    if (!isReadOnlyDbError(err)) throw err
    write(fallbackToMemoryDb(err))
  }
}

export function classifyAutomationOwner(task: string): AutomationOwner {
  const text = task.toLowerCase()
  if (/\bspotify|music|song|track|playlist\b/.test(text))
    return { id: "spotify", label: "Spotify Agent" }
  if (/\bwhats\s*app|whatsapp|telegram|message|text|msg|send\b/.test(text))
    return { id: "messaging", label: "Messaging Agent" }
  if (/\bbrowser|website|web|url|chrome|edge|search|open\s+https?:\/\//.test(text))
    return { id: "browser", label: "Browser Agent" }
  if (/\bcalendar|meeting|reminder|schedule|event\b/.test(text))
    return { id: "calendar", label: "Calendar Agent" }
  if (/\bfile|folder|notepad|save|delete|rename|copy|paste\b/.test(text))
    return { id: "windows", label: "Windows Agent" }
  if (/\bresearch|summari[sz]e|find|compare|investigate\b/.test(text))
    return { id: "research", label: "Research Agent" }
  return { id: "automation", label: "Automation Agent" }
}

export function classifyAutomationRisk(text: string): AutomationRisk {
  if (/\b(delete|remove|send|email|pay|buy|purchase|transfer|submit|uninstall|format)\b/i.test(text))
    return "dangerous"
  if (/\b(create|draft|schedule|save|post|message|edit|update|rename)\b/i.test(text))
    return "moderate"
  return "safe"
}

export function buildAutomationPreview(task: string): AutomationPreview {
  const owner = classifyAutomationOwner(task)
  const risk = classifyAutomationRisk(task)
  const base = owner.id === "spotify" ? ["Find Spotify", "Run playback action"] : owner.id === "browser" ? ["Open browser context", "Inspect page", "Run requested web action"] : owner.id === "messaging" ? ["Open messaging app", "Find recipient or chat", "Prepare message", "Wait for approval if sending"] : ["Inspect current context", "Choose the right tool", "Run the requested action"]
  return {
    steps: base,
    estimatedSeconds: Math.max(8, base.length * 5),
    risk,
    confidence: risk === "dangerous" ? 0.72 : 0.82,
  }
}

export function startAutomationRun(task: string): AutomationSession {
  const now = new Date().toISOString()
  const owner = classifyAutomationOwner(task)
  const run: AutomationRun = {
    id: `run-${Date.now()}-${++runSeq}`,
    owner,
    task,
    state: "thinking",
    startedAt: now,
    confidence: buildAutomationPreview(task).confidence,
    timeline: [],
  }
  const replayId = `replay-${run.id}`
  run.replayId = replayId
  runWrite((target) =>
    target
      .query(
        `insert or replace into automation_runs
         (id, replay_id, task, owner_id, owner_label, status, started_at, command, timeline_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(run.id, replayId, task, owner.id, owner.label, "running", now, task, "[]"),
  )
  return { run, events: [{ type: "automation_started", run }] }
}

export function previewAutomation(session: AutomationSession): SseEvent {
  const preview = buildAutomationPreview(session.run.task)
  session.run.estimatedSeconds = preview.estimatedSeconds
  session.run.confidence = preview.confidence
  return { type: "automation_preview", runId: session.run.id, preview }
}

export function stepAutomation(
  session: AutomationSession,
  currentStep: string,
  opts: { state?: AutomationState; nextStep?: string; step?: number; maxSteps?: number } = {},
): SseEvent {
  session.run.state = opts.state ?? "executing"
  session.run.currentStep = currentStep
  session.run.nextStep = opts.nextStep
  session.run.step = opts.step
  session.run.maxSteps = opts.maxSteps
  return {
    type: "automation_step",
    runId: session.run.id,
    state: session.run.state,
    currentStep,
    nextStep: opts.nextStep,
    step: opts.step,
    maxSteps: opts.maxSteps,
    estimatedSeconds: session.run.estimatedSeconds,
    confidence: session.run.confidence,
  }
}

export function timelineAutomation(
  session: AutomationSession,
  label: string,
  status: AutomationTimelineItem["status"],
  detail?: string,
): SseEvent {
  const item: AutomationTimelineItem = {
    id: `item-${++itemSeq}`,
    at: new Date().toISOString(),
    label,
    status,
    detail,
  }
  session.run.timeline.push(item)
  persistTimeline(session)
  return { type: "automation_timeline", runId: session.run.id, item }
}

export function waitingAutomation(
  session: AutomationSession,
  reason: string,
  risk: AutomationRisk,
): SseEvent {
  session.run.state = risk === "dangerous" ? "needs_approval" : "waiting"
  return { type: "automation_waiting", runId: session.run.id, reason, risk }
}

export function recoveringAutomation(session: AutomationSession, reason: string): SseEvent {
  session.run.state = "recovering"
  return { type: "automation_recovering", runId: session.run.id, reason }
}

export function completeAutomation(session: AutomationSession, summary: string): SseEvent {
  session.run.state = "completed"
  const endedAt = new Date().toISOString()
  session.run.endedAt = endedAt
  runWrite((target) =>
    target
      .query(
        "update automation_runs set status = ?, ended_at = ?, summary = ?, timeline_json = ? where id = ?",
      )
      .run(
        "completed",
        endedAt,
        summary,
        JSON.stringify(session.run.timeline),
        session.run.id,
      ),
  )
  return { type: "automation_completed", runId: session.run.id, summary, replayId: session.run.replayId }
}

export function failAutomation(session: AutomationSession, error: string): SseEvent {
  session.run.state = "failed"
  const endedAt = new Date().toISOString()
  session.run.endedAt = endedAt
  runWrite((target) =>
    target
      .query(
        "update automation_runs set status = ?, ended_at = ?, summary = ?, timeline_json = ? where id = ?",
      )
      .run("failed", endedAt, error, JSON.stringify(session.run.timeline), session.run.id),
  )
  return { type: "automation_failed", runId: session.run.id, error, replayId: session.run.replayId }
}

export function getReplayCommand(replayId: string): string | null {
  const row = getDb()
    .query("select command from automation_runs where replay_id = ?")
    .get(replayId) as { command?: string } | null
  return row?.command ?? null
}

export interface WorkflowReplay {
  replayId: string
  task: string
  ownerId: string
  ownerLabel: string
  status: "completed" | "failed" | "running" | string
  startedAt: string
  endedAt: string | null
  summary: string | null
}

interface WorkflowReplayRow {
  replay_id: string
  task: string
  owner_id: string
  owner_label: string
  status: string
  started_at: string
  ended_at: string | null
  summary: string | null
}

export function listWorkflowReplays(limit = 10): WorkflowReplay[] {
  const rows = getDb()
    .query(
      `select replay_id, task, owner_id, owner_label, status, started_at, ended_at, summary
       from automation_runs
       where replay_id is not null and status = 'completed'
       order by ended_at desc, started_at desc
       limit ?`,
    )
    .all(Math.max(0, Math.min(limit, 50))) as WorkflowReplayRow[]
  return rows.map((row) => ({
    replayId: row.replay_id,
    task: row.task,
    ownerId: row.owner_id,
    ownerLabel: row.owner_label,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    summary: row.summary,
  }))
}

export function countWorkflowReplays(): number {
  const row = getDb()
    .query(
      `select count(*) as count
       from automation_runs
       where replay_id is not null and status = 'completed'`,
    )
    .get() as { count?: number } | null
  return row?.count ?? 0
}

export function redactAutomationPayload(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length > 240) return `${value.slice(0, 240)}...`
    if (/^[A-Za-z0-9+/]{200,}={0,2}$/.test(value)) return "[redacted-base64]"
    return value
  }
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.slice(0, 8).map(redactAutomationPayload)
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (/secret|token|key|password|audio|screenshot|base64|b64/i.test(key)) out[key] = "[redacted]"
    else out[key] = redactAutomationPayload(entry)
  }
  return out
}

function persistTimeline(session: AutomationSession): void {
  runWrite((target) =>
    target
      .query("update automation_runs set timeline_json = ? where id = ?")
      .run(JSON.stringify(session.run.timeline), session.run.id),
  )
}

export function __resetAutomationRunsForTest(): void {
  try {
    db?.close()
  } catch {
    /* already closed */
  }
  db = null
  runSeq = 0
  itemSeq = 0
  warnedMemoryFallback = false
}
