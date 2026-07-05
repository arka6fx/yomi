import { Database } from "bun:sqlite"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { notepadDir } from "../memory/loader.js"

export type UsageEventKind = "fast_query" | "agent_run" | "stt" | "tts" | "compression"
export type SessionKind = "fast" | "agent"

export type UsageEventRow = {
  id: string
  kind: UsageEventKind
  model: string | null
  inputTokens: number
  outputTokens: number
  costCents: number
  status: string
  createdAt: string
}

export type SessionRow = {
  id: string
  kind: SessionKind
  model: string | null
  inputTokens: number
  outputTokens: number
  costCents: number
  startedAt: string
  endedAt: string | null
  status: string
}

let db: Database | null = null
let openedPath: string | null = null

function dbPath(): string {
  return join(notepadDir(), "usage.db")
}

function nowISO(): string {
  return new Date().toISOString()
}

function openDb(): Database {
  const path = dbPath()
  if (db && openedPath === path) return db
  db?.close()
  db = new Database(path, { create: true })
  openedPath = path
  db.exec(`
    create table if not exists usage_events (
      id text primary key,
      kind text not null,
      model text,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      cost_cents integer not null default 0,
      status text not null default 'done',
      created_at text not null
    );
    create table if not exists sessions (
      id text primary key,
      kind text not null,
      model text,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      cost_cents integer not null default 0,
      started_at text not null,
      ended_at text,
      status text not null default 'active'
    );
    create index if not exists usage_events_kind_idx on usage_events(kind);
    create index if not exists usage_events_created_idx on usage_events(created_at);
    create index if not exists sessions_kind_idx on sessions(kind);
    create index if not exists sessions_started_idx on sessions(started_at);
  `)
  return db
}

/** Ensure the DB directory exists and tables are created. */
export async function initUsageStore(): Promise<void> {
  await mkdir(notepadDir(), { recursive: true })
  openDb()
}

export function closeUsageStore(): void {
  db?.close()
  db = null
  openedPath = null
}

/** Reset for testing — closes DB and removes the file. */
export async function resetUsageStore(): Promise<void> {
  const path = dbPath()
  db?.close()
  db = null
  openedPath = null
  await rm(path, { force: true }).catch(() => {})
}

export function logUsageEvent(event: {
  kind: UsageEventKind
  model?: string | null
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  status?: string
  id?: string
}): void {
  const d = openDb()
  const id = event.id ?? crypto.randomUUID()
  d.run(
    `insert into usage_events (id, kind, model, input_tokens, output_tokens, cost_cents, status, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      event.kind,
      event.model ?? null,
      event.inputTokens ?? 0,
      event.outputTokens ?? 0,
      event.costCents ?? 0,
      event.status ?? "done",
      nowISO(),
    ],
  )
}

export function startSession(session: {
  kind: SessionKind
  model?: string | null
  id?: string
}): string {
  const d = openDb()
  const id = session.id ?? crypto.randomUUID()
  d.run(
    `insert into sessions (id, kind, model, input_tokens, output_tokens, cost_cents, started_at, status)
     values (?, ?, ?, 0, 0, 0, ?, 'active')`,
    [id, session.kind, session.model ?? null, nowISO()],
  )
  return id
}

export function completeSession(
  id: string,
  stats?: {
    inputTokens?: number
    outputTokens?: number
    costCents?: number
    status?: string
  },
): void {
  const d = openDb()
  d.run(
    `update sessions
     set ended_at = ?, status = ?, input_tokens = ?, output_tokens = ?, cost_cents = ?
     where id = ?`,
    [
      nowISO(),
      stats?.status ?? "completed",
      stats?.inputTokens ?? 0,
      stats?.outputTokens ?? 0,
      stats?.costCents ?? 0,
      id,
    ],
  )
}

/** Query usage events within a lookback window (days). */
export function queryUsageEvents(days: number): UsageEventRow[] {
  const d = openDb()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return d
    .query<Record<string, unknown>, [string]>(
      `select id, kind, model, input_tokens as inputTokens, output_tokens as outputTokens,
              cost_cents as costCents, status, created_at as createdAt
       from usage_events where created_at >= ? order by created_at asc`,
    )
    .all(since)
    .map(mapEventRow)
}

function mapEventRow(r: Record<string, unknown>): UsageEventRow {
  return {
    id: r.id as string,
    kind: r.kind as UsageEventKind,
    model: r.model as string | null,
    inputTokens: Number(r.inputTokens ?? 0),
    outputTokens: Number(r.outputTokens ?? 0),
    costCents: Number(r.costCents ?? 0),
    status: r.status as string,
    createdAt: r.createdAt as string,
  }
}

/** Query sessions within a lookback window (days). */
export function querySessions(days: number): SessionRow[] {
  const d = openDb()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return d
    .query<Record<string, unknown>, [string]>(
      `select id, kind, model,
              input_tokens as inputTokens, output_tokens as outputTokens,
              cost_cents as costCents,
              started_at as startedAt, ended_at as endedAt, status
       from sessions where started_at >= ? order by started_at asc`,
    )
    .all(since)
    .map(mapSessionRow)
}

function mapSessionRow(r: Record<string, unknown>): SessionRow {
  return {
    id: r.id as string,
    kind: r.kind as SessionKind,
    model: r.model as string | null,
    inputTokens: Number(r.inputTokens ?? 0),
    outputTokens: Number(r.outputTokens ?? 0),
    costCents: Number(r.costCents ?? 0),
    startedAt: r.startedAt as string,
    endedAt: r.endedAt as string | null,
    status: r.status as string,
  }
}

/** Aggregate usage events by day for trend analysis. */
export function queryDailyUsage(days: number): {
  date: string
  kind: string
  count: number
}[] {
  const d = openDb()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return d
    .query<{ date: string; kind: string; count: number }, [string]>(
      `select date(created_at) as date, kind, count(*) as count
       from usage_events
       where created_at >= ?
       group by date(created_at), kind
       order by date asc`,
    )
    .all(since) as { date: string; kind: string; count: number }[]
}

/** Aggregate sessions by day with token totals. */
export function queryDailySessions(days: number): {
  date: string
  kind: string
  count: number
  totalTokens: number
}[] {
  const d = openDb()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return d
    .query<{ date: string; kind: string; count: number; totalTokens: number }, [string]>(
      `select date(started_at) as date, kind, count(*) as count,
              sum(input_tokens + output_tokens) as total_tokens
       from sessions
       where started_at >= ?
       group by date(started_at), kind
       order by date asc`,
    )
    .all(since) as { date: string; kind: string; count: number; totalTokens: number }[]
}

/** Get activity by hour of day. */
export function queryHourlyActivity(days: number): {
  hour: number
  count: number
}[] {
  const d = openDb()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return d
    .query<{ hour: number; count: number }, [string]>(
      `select cast(strftime('%H', started_at) as integer) as hour, count(*) as count
       from sessions
       where started_at >= ?
       group by hour
       order by hour asc`,
    )
    .all(since) as { hour: number; count: number }[]
}

/** Get model distribution from sessions. */
export function queryModelDistribution(days: number): {
  model: string | null
  count: number
  avgTokens: number
}[] {
  const d = openDb()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return d
    .query<{ model: string | null; count: number; avgTokens: number }, [string]>(
      `select model, count(*) as count,
              cast(avg(input_tokens + output_tokens) as integer) as "avgTokens"
       from sessions
       where started_at >= ? and model is not null
       group by model
       order by count desc`,
    )
    .all(since) as { model: string | null; count: number; avgTokens: number }[]
}

/** Session length in seconds for completed sessions. */
export function querySessionLengths(days: number): {
  seconds: number
}[] {
  const d = openDb()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return d
    .query<{ seconds: number }, [string]>(
      `select cast(
                (julianday(ended_at) - julianday(started_at)) * 86400
              as integer) as seconds
       from sessions
       where started_at >= ? and ended_at is not null
       order by seconds asc`,
    )
    .all(since) as { seconds: number }[]
}
